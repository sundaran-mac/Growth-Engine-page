/**
 * Claude wrapper. Claude drafts words only and never approves anything.
 *
 * - Model from ANTHROPIC_MODEL (default claude-opus-5-5).
 * - No key: every call throws FEATURE_DISABLED (503), so the UI can show "not set up".
 * - Monthly token cap per product: `product_settings.claude_monthly_token_cap` when set, else
 *   CLAUDE_MONTHLY_TOKEN_CAP. A cap of 0 means no cap. Checked before each call, usage recorded
 *   after each call in `claude_usage`.
 * - Server-side refusal fallback is on (`fallbacks: "default"`), so a declined request is retried
 *   on Anthropic's recommended fallback model inside the same call.
 *
 * Prompts live in the module that owns the feature (for example IDEAS), not here.
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { env } from '../config/env.js';
import { db } from '../db/client.js';
import { claudeUsage, productSettings } from '../db/schema/index.js';
import { AppError, featureDisabled } from './errors.js';
import { logger } from './logger.js';
import { monthKey } from './time.js';

export type ClaudeEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const DEFAULT_MAX_TOKENS = 16_000;
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

export interface ClaudeCallOptions {
  /** Product the tokens are charged to. Null for calls that belong to no product. */
  productId: string | null;
  /** Short name for logs, for example `ideas.generate` or `brief.cowrite`. */
  feature: string;
  system: string;
  prompt: string;
  maxTokens?: number;
  effort?: ClaudeEffort;
}

export interface ClaudeUsageResult {
  inputTokens: number;
  outputTokens: number;
  model: string;
}

/** Minimal surface of the SDK we use, so tests can pass a fake. */
export type ClaudeClient = Pick<Anthropic, 'beta'>;

let client: ClaudeClient | null = null;

export function isClaudeEnabled(): boolean {
  return env.anthropic !== null || client !== null;
}

function getClient(): ClaudeClient {
  if (client) return client;
  if (!env.anthropic) {
    throw featureDisabled('Claude', 'Claude is turned off because ANTHROPIC_API_KEY is not set.');
  }
  client = new Anthropic({
    apiKey: env.anthropic.apiKey,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: 2,
  });
  return client;
}

/** Test hook: swap in a fake client (pass null to reset). */
export function setClaudeClientForTests(fake: ClaudeClient | null): void {
  client = fake;
}

function model(): string {
  return env.anthropic?.model ?? env.anthropicModel;
}

function envCap(): number {
  return env.anthropic?.monthlyTokenCap ?? env.claudeMonthlyTokenCap;
}

/**
 * The cap that applies now: the product's own cap from Settings when set, else the env cap.
 * Calls with no product always use the env cap. 0 means no cap.
 */
export async function effectiveCap(productId: string | null): Promise<number> {
  if (productId === null) return envCap();
  const [row] = await db
    .select({ cap: productSettings.claudeMonthlyTokenCap })
    .from(productSettings)
    .where(eq(productSettings.productId, productId));
  return row?.cap ?? envCap();
}

const productFilter = (productId: string | null) =>
  productId === null ? isNull(claudeUsage.productId) : eq(claudeUsage.productId, productId);

/**
 * Tokens used this month for a product (input + output). `capTokens` is the cap in force now
 * (see `effectiveCap`), not the value stamped on the usage row, so a cap changed in Settings
 * takes effect at once.
 */
export async function getMonthlyUsage(
  productId: string | null,
  month = monthKey(new Date()),
): Promise<{ inputTokens: number; outputTokens: number; capTokens: number; requestCount: number }> {
  const [[row], capTokens] = await Promise.all([
    db
      .select()
      .from(claudeUsage)
      .where(and(productFilter(productId), eq(claudeUsage.month, month))),
    effectiveCap(productId),
  ]);
  return {
    inputTokens: row?.inputTokens ?? 0,
    outputTokens: row?.outputTokens ?? 0,
    capTokens,
    requestCount: row?.requestCount ?? 0,
  };
}

export async function assertUnderCap(productId: string | null): Promise<void> {
  const usage = await getMonthlyUsage(productId);
  if (usage.capTokens > 0 && usage.inputTokens + usage.outputTokens >= usage.capTokens) {
    throw new AppError({
      status: 429,
      code: 'CLAUDE_CAP_REACHED',
      title: 'Claude budget used up',
      detail: 'This product has used its Claude budget for this month.',
    });
  }
}

/** Adds tokens to this month's row (atomic upsert) and stamps the cap in force. */
export async function recordUsage(
  productId: string | null,
  inputTokens: number,
  outputTokens: number,
  month = monthKey(new Date()),
): Promise<void> {
  const capTokens = await effectiveCap(productId);
  await db
    .insert(claudeUsage)
    .values({ productId, month, inputTokens, outputTokens, capTokens, requestCount: 1 })
    .onConflictDoUpdate({
      target: [claudeUsage.productId, claudeUsage.month],
      set: {
        inputTokens: sql`${claudeUsage.inputTokens} + excluded.input_tokens`,
        outputTokens: sql`${claudeUsage.outputTokens} + excluded.output_tokens`,
        requestCount: sql`${claudeUsage.requestCount} + 1`,
        capTokens: sql`excluded.cap_tokens`,
        updatedAt: new Date(),
      },
    });
}

interface UsageLike {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

function totalInput(u: UsageLike): number {
  return u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
}

function mapSdkError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof Anthropic.RateLimitError) {
    return new AppError({
      status: 429,
      code: 'CLAUDE_RATE_LIMITED',
      title: 'Claude is busy',
      detail: 'Try again in a minute.',
      cause: err,
    });
  }
  if (
    err instanceof Anthropic.AuthenticationError ||
    err instanceof Anthropic.PermissionDeniedError
  ) {
    return new AppError({
      status: 503,
      code: 'FEATURE_DISABLED',
      title: 'Claude key not accepted',
      detail: 'Check ANTHROPIC_API_KEY.',
      cause: err,
    });
  }
  if (err instanceof Anthropic.APIError) {
    return new AppError({
      status: 502,
      code: 'CLAUDE_FAILED',
      title: 'Claude call failed',
      detail: 'Claude did not answer. Try again.',
      cause: err,
    });
  }
  return new AppError({
    status: 502,
    code: 'CLAUDE_FAILED',
    title: 'Claude call failed',
    detail: 'Claude did not answer. Try again.',
    cause: err,
  });
}

function checkStop(stopReason: string | null): void {
  if (stopReason === 'refusal') {
    throw new AppError({
      status: 422,
      code: 'CLAUDE_REFUSED',
      title: 'Claude declined',
      detail: 'Claude declined this request. Rewrite the input and try again.',
    });
  }
  if (stopReason === 'max_tokens') {
    throw new AppError({
      status: 502,
      code: 'CLAUDE_FAILED',
      title: 'Claude answer cut off',
      detail: 'The answer was too long. Ask for less and try again.',
    });
  }
}

/**
 * Structured output: Claude's answer is validated against the zod schema.
 * Example: `const { data } = await generateJson({ productId, feature: 'ideas.generate', system, prompt, schema })`.
 */
export async function generateJson<S extends z.ZodType>(
  opts: ClaudeCallOptions & { schema: S },
): Promise<{ data: z.infer<S>; usage: ClaudeUsageResult }> {
  const c = getClient();
  await assertUnderCap(opts.productId);
  const started = Date.now();
  let message;
  try {
    message = await c.beta.messages.parse({
      model: model(),
      max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      system: opts.system,
      messages: [{ role: 'user', content: opts.prompt }],
      output_config: { effort: opts.effort ?? 'medium', format: betaZodOutputFormat(opts.schema) },
    });
  } catch (err) {
    throw mapSdkError(err);
  }
  const usage = {
    inputTokens: totalInput(message.usage),
    outputTokens: message.usage.output_tokens,
    model: message.model,
  };
  await recordUsage(opts.productId, usage.inputTokens, usage.outputTokens);
  logger.info(
    { feature: opts.feature, ms: Date.now() - started, ...usage, stop: message.stop_reason },
    'claude call',
  );
  checkStop(message.stop_reason);
  if (message.parsed_output === null || message.parsed_output === undefined) {
    throw new AppError({
      status: 502,
      code: 'CLAUDE_FAILED',
      title: 'Claude answer not usable',
      detail: 'The answer did not match the expected shape. Try again.',
    });
  }
  return { data: message.parsed_output as z.infer<S>, usage };
}

/** Plain text answer (notes, captions). */
export async function generateText(
  opts: ClaudeCallOptions,
): Promise<{ text: string; usage: ClaudeUsageResult }> {
  const c = getClient();
  await assertUnderCap(opts.productId);
  const started = Date.now();
  let message;
  try {
    message = await c.beta.messages.create({
      model: model(),
      max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      system: opts.system,
      messages: [{ role: 'user', content: opts.prompt }],
      output_config: { effort: opts.effort ?? 'medium' },
    });
  } catch (err) {
    throw mapSdkError(err);
  }
  const usage = {
    inputTokens: totalInput(message.usage),
    outputTokens: message.usage.output_tokens,
    model: message.model,
  };
  await recordUsage(opts.productId, usage.inputTokens, usage.outputTokens);
  logger.info(
    { feature: opts.feature, ms: Date.now() - started, ...usage, stop: message.stop_reason },
    'claude call',
  );
  checkStop(message.stop_reason);
  const text = message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  return { text, usage };
}
