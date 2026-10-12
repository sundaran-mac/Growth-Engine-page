/**
 * Environment config, parsed once with zod (BUILD-PLAN section 4).
 *
 * Rules:
 * - Empty strings count as "not set" (the committed `.env` has empty values).
 * - production: every secret and every third-party key is required. The process stops on start.
 * - development and test: local infra uses Docker defaults; missing secrets get a dev-only value
 *   (with a warning); missing third-party keys switch that feature off (never a crash).
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const here = dirname(fileURLToPath(import.meta.url));
/** Repo root `.env` (apps/api/src/config or apps/api/dist/config, four levels up). */
export const ROOT_ENV_FILE = resolve(here, '../../../../.env');

const LOCAL_DB = 'postgres://growthdesk:growthdesk-dev@localhost:5433';

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const opt = () => z.preprocess(emptyToUndefined, z.string().trim().optional());
const optUrl = () => z.preprocess(emptyToUndefined, z.url().optional());
const bool = (def: boolean) =>
  z.preprocess((v) => {
    const e = emptyToUndefined(v);
    if (e === undefined) return def;
    return typeof e === 'string' ? ['1', 'true', 'yes', 'on'].includes(e.toLowerCase()) : e;
  }, z.boolean());
const int = (def: number) => z.preprocess(emptyToUndefined, z.coerce.number().int().default(def));

const rawSchema = z.object({
  NODE_ENV: z.preprocess(
    emptyToUndefined,
    z.enum(['development', 'test', 'production']).default('development'),
  ),
  PORT: int(4000).pipe(z.number().min(1).max(65535)),
  LOG_LEVEL: z.preprocess(
    emptyToUndefined,
    z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  ),
  TRUST_PROXY: int(0).pipe(z.number().min(0).max(10)),
  WEB_ORIGIN: opt(),
  PUBLIC_API_URL: optUrl(),
  APP_TIMEZONE: z.preprocess(emptyToUndefined, z.string().default('Asia/Kolkata')),

  DATABASE_URL: optUrl(),
  DATABASE_URL_TEST: optUrl(),
  DATABASE_POOL_MAX: int(10).pipe(z.number().min(1).max(100)),

  SESSION_SECRET: opt(),
  SESSION_TTL_HOURS: int(168).pipe(
    z
      .number()
      .min(1)
      .max(24 * 90),
  ),
  COOKIE_SECURE: z.preprocess(emptyToUndefined, z.enum(['true', 'false']).optional()),
  ENCRYPTION_KEY: opt(),
  SEED_USER_PASSWORD: opt(),

  STORAGE_DRIVER: z.preprocess(emptyToUndefined, z.enum(['r2', 'minio']).optional()),
  STORAGE_BUCKET: opt(),
  R2_ACCOUNT_ID: opt(),
  R2_ACCESS_KEY_ID: opt(),
  R2_SECRET_ACCESS_KEY: opt(),
  R2_BUCKET: opt(),
  R2_PUBLIC_BASE_URL: optUrl(),
  MINIO_ENDPOINT: optUrl(),
  MINIO_PUBLIC_ENDPOINT: optUrl(),
  MINIO_ROOT_USER: opt(),
  MINIO_ROOT_PASSWORD: opt(),

  ANTHROPIC_API_KEY: opt(),
  ANTHROPIC_MODEL: z.preprocess(emptyToUndefined, z.string().default('claude-opus-5-5')),
  CLAUDE_MONTHLY_TOKEN_CAP: int(2_000_000).pipe(z.number().min(0)),
  // Voyage AI embeddings for the content memory (optional everywhere, ADR 0009).
  VOYAGE_API_KEY: opt(),
  VOYAGE_MODEL: z.preprocess(emptyToUndefined, z.string().trim().default('voyage-4')),

  META_APP_ID: opt(),
  META_APP_SECRET: opt(),
  META_WEBHOOK_VERIFY_TOKEN: opt(),
  GOOGLE_CLIENT_ID: opt(),
  GOOGLE_CLIENT_SECRET: opt(),
  LINKEDIN_CLIENT_ID: opt(),
  LINKEDIN_CLIENT_SECRET: opt(),
  OAUTH_REDIRECT_BASE_URL: optUrl(),
  GITHUB_TOKEN: opt(),
  TRACKING_LINK_BASE: z.preprocess(emptyToUndefined, z.string().default('live.humini.app')),

  SMTP_HOST: opt(),
  SMTP_PORT: int(587).pipe(z.number().min(1).max(65535)),
  SMTP_USER: opt(),
  SMTP_PASSWORD: opt(),
  SMTP_FROM: opt(),

  WORKER_ENABLE_CRON: bool(true),
});

type Raw = z.infer<typeof rawSchema>;
export type NodeEnv = Raw['NODE_ENV'];

export interface StorageConfig {
  driver: 'r2' | 'minio';
  bucket: string;
  region: string;
  /** Endpoint the API uses for server-side calls. */
  endpoint: string;
  /** Endpoint baked into presigned URLs (must be reachable from the browser). */
  publicEndpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  /** Optional public CDN base for `getPublicUrl` (R2 custom domain). */
  publicBaseUrl: string | null;
}

export interface AppEnv {
  nodeEnv: NodeEnv;
  isProduction: boolean;
  isTest: boolean;
  port: number;
  logLevel: NonNullable<Raw['LOG_LEVEL']>;
  trustProxy: number;
  webOrigins: string[];
  publicApiUrl: string;
  appTimezone: string;
  databaseUrl: string;
  databaseUrlTest: string;
  databasePoolMax: number;
  sessionSecret: string;
  sessionTtlHours: number;
  cookieSecure: boolean;
  /** 32 raw bytes for AES-256-GCM. */
  encryptionKey: Buffer;
  seedUserPassword: string;
  storage: StorageConfig | null;
  anthropic: { apiKey: string; model: string; monthlyTokenCap: number } | null;
  anthropicModel: string;
  claudeMonthlyTokenCap: number;
  /** Voyage AI embeddings (content memory meaning check). Null turns that layer off. */
  voyage: { apiKey: string; model: string } | null;
  meta: { appId: string; appSecret: string; webhookVerifyToken: string } | null;
  google: { clientId: string; clientSecret: string } | null;
  linkedin: { clientId: string; clientSecret: string } | null;
  oauthRedirectBaseUrl: string;
  githubToken: string | null;
  trackingLinkBase: string;
  smtp: {
    host: string;
    port: number;
    user: string | null;
    password: string | null;
    from: string;
  } | null;
  workerEnableCron: boolean;
  features: {
    claude: boolean;
    storage: boolean;
    meta: boolean;
    google: boolean;
    linkedin: boolean;
    github: boolean;
    smtp: boolean;
  };
}

export class EnvError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid environment:\n  - ${problems.join('\n  - ')}`);
    this.name = 'EnvError';
  }
}

/** Deterministic dev-only secret, so the API and worker processes agree without any setup. */
function devSecret(name: string): string {
  return createHash('sha256').update(`growth-desk-dev-only:${name}`).digest('hex');
}

function parseEncryptionKey(value: string): Buffer | null {
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, 'hex');
  const b64 = Buffer.from(value, 'base64');
  return b64.length === 32 ? b64 : null;
}

function allOrNothing<T>(values: Record<string, string | undefined>, build: () => T): T | null {
  const present = Object.values(values).filter((v) => v !== undefined).length;
  return present === Object.keys(values).length ? build() : null;
}

export interface ParsedEnv {
  env: AppEnv;
  warnings: string[];
}

/** Pure parser (no side effects), so tests can feed it any input. */
export function parseEnv(input: NodeJS.ProcessEnv): ParsedEnv {
  const result = rawSchema.safeParse(input);
  if (!result.success) {
    throw new EnvError(
      result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  const r = result.data;
  const isProduction = r.NODE_ENV === 'production';
  const problems: string[] = [];
  const warnings: string[] = [];

  const required = (name: keyof Raw, value: string | undefined): void => {
    if (isProduction && value === undefined) problems.push(`${name} is required in production`);
  };
  const secret = (name: keyof Raw, value: string | undefined): string => {
    if (value !== undefined) return value;
    if (isProduction) {
      problems.push(`${name} is required in production`);
      return '';
    }
    if (r.NODE_ENV === 'development') {
      warnings.push(`${name} is not set: using a dev-only value. Never use this in production.`);
    }
    return devSecret(name);
  };

  // Core URLs.
  required('WEB_ORIGIN', r.WEB_ORIGIN);
  required('PUBLIC_API_URL', r.PUBLIC_API_URL);
  required('DATABASE_URL', r.DATABASE_URL);
  const webOrigins = (r.WEB_ORIGIN ?? 'http://localhost:5173,http://localhost:8080')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
  const publicApiUrl = (r.PUBLIC_API_URL ?? `http://localhost:${r.PORT}`).replace(/\/$/, '');

  // Secrets.
  const sessionSecret = secret('SESSION_SECRET', r.SESSION_SECRET);
  if (r.SESSION_SECRET !== undefined && r.SESSION_SECRET.length < 32) {
    problems.push('SESSION_SECRET must be at least 32 characters');
  }
  const encRaw = secret('ENCRYPTION_KEY', r.ENCRYPTION_KEY);
  const encryptionKey = parseEncryptionKey(encRaw) ?? Buffer.alloc(32);
  if (encRaw !== '' && parseEncryptionKey(encRaw) === null) {
    problems.push('ENCRYPTION_KEY must be 32 bytes as 64 hex characters or base64');
  }
  if (isProduction && r.SEED_USER_PASSWORD !== undefined) {
    warnings.push('SEED_USER_PASSWORD is set in production; the seed never runs in production.');
  }

  // Storage.
  const driver = r.STORAGE_DRIVER ?? (isProduction ? undefined : 'minio');
  required('STORAGE_DRIVER', r.STORAGE_DRIVER);
  let storage: StorageConfig | null = null;
  if (driver === 'r2') {
    storage = allOrNothing(
      {
        R2_ACCOUNT_ID: r.R2_ACCOUNT_ID,
        R2_ACCESS_KEY_ID: r.R2_ACCESS_KEY_ID,
        R2_SECRET_ACCESS_KEY: r.R2_SECRET_ACCESS_KEY,
        R2_BUCKET: r.R2_BUCKET,
      },
      () => {
        const endpoint = `https://${r.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
        return {
          driver: 'r2' as const,
          bucket: r.R2_BUCKET!,
          region: 'auto',
          endpoint,
          publicEndpoint: endpoint,
          accessKeyId: r.R2_ACCESS_KEY_ID!,
          secretAccessKey: r.R2_SECRET_ACCESS_KEY!,
          forcePathStyle: false,
          publicBaseUrl: r.R2_PUBLIC_BASE_URL?.replace(/\/$/, '') ?? null,
        };
      },
    );
    if (!storage) {
      const msg =
        'STORAGE_DRIVER=r2 needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET';
      if (isProduction) problems.push(msg);
      else warnings.push(`${msg}. Uploads are off.`);
    }
  } else if (driver === 'minio') {
    const endpoint = r.MINIO_ENDPOINT ?? 'http://localhost:9000';
    storage = {
      driver: 'minio',
      bucket: r.STORAGE_BUCKET ?? 'growth-desk',
      region: 'us-east-1',
      endpoint,
      publicEndpoint: r.MINIO_PUBLIC_ENDPOINT ?? endpoint,
      accessKeyId: r.MINIO_ROOT_USER ?? 'growthdesk',
      secretAccessKey: r.MINIO_ROOT_PASSWORD ?? 'growthdesk-dev-secret',
      forcePathStyle: true,
      publicBaseUrl: null,
    };
    if (isProduction && (!r.MINIO_ROOT_USER || !r.MINIO_ROOT_PASSWORD)) {
      problems.push(
        'STORAGE_DRIVER=minio needs MINIO_ROOT_USER and MINIO_ROOT_PASSWORD in production',
      );
    }
  }

  // Third-party keys: required in production, feature-off in development.
  const thirdParty = <T>(
    feature: string,
    values: Record<string, string | undefined>,
    build: () => T,
  ) => {
    const built = allOrNothing(values, build);
    if (!built) {
      const names = Object.keys(values).join(', ');
      if (isProduction) problems.push(`${names} required in production (${feature})`);
      else if (r.NODE_ENV === 'development')
        warnings.push(`${feature} is off: set ${names} to turn it on.`);
    }
    return built;
  };

  const anthropic = thirdParty('Claude', { ANTHROPIC_API_KEY: r.ANTHROPIC_API_KEY }, () => ({
    apiKey: r.ANTHROPIC_API_KEY!,
    model: r.ANTHROPIC_MODEL,
    monthlyTokenCap: r.CLAUDE_MONTHLY_TOKEN_CAP,
  }));
  const meta = thirdParty(
    'Meta (Instagram, Facebook)',
    {
      META_APP_ID: r.META_APP_ID,
      META_APP_SECRET: r.META_APP_SECRET,
      META_WEBHOOK_VERIFY_TOKEN: r.META_WEBHOOK_VERIFY_TOKEN,
    },
    () => ({
      appId: r.META_APP_ID!,
      appSecret: r.META_APP_SECRET!,
      webhookVerifyToken: r.META_WEBHOOK_VERIFY_TOKEN!,
    }),
  );
  const google = thirdParty(
    'Google (YouTube)',
    { GOOGLE_CLIENT_ID: r.GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET: r.GOOGLE_CLIENT_SECRET },
    () => ({ clientId: r.GOOGLE_CLIENT_ID!, clientSecret: r.GOOGLE_CLIENT_SECRET! }),
  );
  const linkedin = thirdParty(
    'LinkedIn',
    { LINKEDIN_CLIENT_ID: r.LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET: r.LINKEDIN_CLIENT_SECRET },
    () => ({ clientId: r.LINKEDIN_CLIENT_ID!, clientSecret: r.LINKEDIN_CLIENT_SECRET! }),
  );
  const githubToken = thirdParty(
    'GitHub kit refresh',
    { GITHUB_TOKEN: r.GITHUB_TOKEN },
    () => r.GITHUB_TOKEN!,
  );

  // SMTP is optional everywhere.
  const smtp =
    r.SMTP_HOST && r.SMTP_FROM
      ? {
          host: r.SMTP_HOST,
          port: r.SMTP_PORT,
          user: r.SMTP_USER ?? null,
          password: r.SMTP_PASSWORD ?? null,
          from: r.SMTP_FROM,
        }
      : null;

  if (problems.length > 0) throw new EnvError(problems);

  const env: AppEnv = {
    nodeEnv: r.NODE_ENV,
    isProduction,
    isTest: r.NODE_ENV === 'test',
    port: r.PORT,
    logLevel: r.LOG_LEVEL ?? (r.NODE_ENV === 'test' ? 'silent' : isProduction ? 'info' : 'debug'),
    trustProxy: r.TRUST_PROXY,
    webOrigins,
    publicApiUrl,
    appTimezone: r.APP_TIMEZONE,
    databaseUrl: r.DATABASE_URL ?? `${LOCAL_DB}/growth_desk`,
    databaseUrlTest: r.DATABASE_URL_TEST ?? `${LOCAL_DB}/growth_desk_test`,
    databasePoolMax: r.DATABASE_POOL_MAX,
    sessionSecret,
    sessionTtlHours: r.SESSION_TTL_HOURS,
    cookieSecure: r.COOKIE_SECURE ? r.COOKIE_SECURE === 'true' : isProduction,
    encryptionKey,
    seedUserPassword: r.SEED_USER_PASSWORD ?? 'growthdesk-dev',
    storage,
    anthropic,
    anthropicModel: r.ANTHROPIC_MODEL,
    claudeMonthlyTokenCap: r.CLAUDE_MONTHLY_TOKEN_CAP,
    voyage: r.VOYAGE_API_KEY ? { apiKey: r.VOYAGE_API_KEY, model: r.VOYAGE_MODEL } : null,
    meta,
    google,
    linkedin,
    oauthRedirectBaseUrl: (r.OAUTH_REDIRECT_BASE_URL ?? publicApiUrl).replace(/\/$/, ''),
    githubToken,
    trackingLinkBase: r.TRACKING_LINK_BASE,
    smtp,
    workerEnableCron: r.WORKER_ENABLE_CRON,
    features: {
      claude: anthropic !== null,
      storage: storage !== null,
      meta: meta !== null,
      google: google !== null,
      linkedin: linkedin !== null,
      github: githubToken !== null,
      smtp: smtp !== null,
    },
  };
  return { env, warnings };
}

function loadDotEnv(): void {
  if (existsSync(ROOT_ENV_FILE)) {
    // Never overrides variables that are already set (Docker, CI, shell).
    process.loadEnvFile(ROOT_ENV_FILE);
  }
}

let cached: ParsedEnv | undefined;

/** Parsed env for this process. Loads the repo root `.env` once if it exists. */
export function loadEnv(): ParsedEnv {
  if (!cached) {
    loadDotEnv();
    cached = parseEnv(process.env);
  }
  return cached;
}

export const env: AppEnv = loadEnv().env;
export const envWarnings: string[] = loadEnv().warnings;
