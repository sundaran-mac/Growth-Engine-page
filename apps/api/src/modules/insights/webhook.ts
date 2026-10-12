/**
 * Meta (Instagram) webhook: GET verifies the subscription, POST carries comment events.
 * POST checks `X-Hub-Signature-256` over the RAW body (kept by app.ts for /webhooks/* only).
 */
import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { metaWebhookPayloadSchema, metaWebhookVerifyQuerySchema } from '@growth-desk/contract';
import { env } from '../../config/env.js';
import { AppError, badRequest, featureDisabled, forbidden } from '../../lib/errors.js';
import { verifyMetaSignature } from './logic.js';
import { processMetaWebhook } from './keywords.service.js';

export interface MetaWebhookConfig {
  appSecret: string;
  webhookVerifyToken: string;
}

let override: MetaWebhookConfig | null | undefined;

/** Test hook: set the Meta config (pass undefined to go back to env). */
export function setMetaWebhookConfigForTests(config: MetaWebhookConfig | null | undefined): void {
  override = config;
}

function config(): MetaWebhookConfig {
  const c = override === undefined ? env.meta : override;
  if (!c)
    throw featureDisabled('Meta webhook', 'Set META_APP_SECRET and META_WEBHOOK_VERIFY_TOKEN.');
  return c;
}

function sameString(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const metaWebhookRouter: Router = Router();

metaWebhookRouter.get('/webhooks/meta', (req, res) => {
  const cfg = config();
  const q = metaWebhookVerifyQuerySchema.safeParse(req.query);
  if (!q.success) throw badRequest('Not a Meta subscription check.');
  if (!sameString(q.data['hub.verify_token'], cfg.webhookVerifyToken)) {
    throw forbidden('Verify token does not match.', 'WEBHOOK_TOKEN_MISMATCH');
  }
  res.status(200).type('text/plain').send(q.data['hub.challenge']);
});

metaWebhookRouter.post('/webhooks/meta', async (req, res) => {
  const cfg = config();
  if (!req.rawBody) throw badRequest('Send the event as application/json.');
  if (!verifyMetaSignature(req.rawBody, req.get('x-hub-signature-256'), cfg.appSecret)) {
    throw new AppError({
      status: 401,
      code: 'WEBHOOK_SIGNATURE_INVALID',
      title: 'Signature not valid',
      detail: 'X-Hub-Signature-256 does not match the body.',
    });
  }
  const payload = metaWebhookPayloadSchema.safeParse(req.body);
  if (!payload.success) throw badRequest('The event body has an unexpected shape.');
  const result = await processMetaWebhook(payload.data);
  req.log.info({ ...result }, 'meta webhook processed');
  res.status(200).json(result);
});
