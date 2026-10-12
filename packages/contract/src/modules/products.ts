/**
 * Module contract for the products module (PRODUCTS agent).
 * Products, product kits, product members, the team (users) and the Integrations status.
 * Names are unique across modules because everything is re-exported from the package root.
 */
import { z } from 'zod';
import { isoDateTimeSchema, paginationQuerySchema, uuidSchema } from '../common.js';
import {
  channelActionSchema,
  channelStatusSchema,
  integrationStatusSchema,
  platformSchema,
  productRoleSchema,
  productStatusSchema,
  roleSchema,
} from '../enums.js';
import {
  kitBehaviourSchema,
  kitNotBuiltSchema,
  productKitSchema,
  productMemberSchema,
  productSchema,
  userRefSchema,
  userSchema,
} from '../entities.js';

/* ---------- Small field schemas ---------- */

export const productSlugSchema = z
  .string()
  .trim()
  .min(2, 'Use at least 2 characters')
  .max(48, 'Use 48 characters or fewer')
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'Use lower case letters, numbers and dashes');

export const productColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #ff9a00');

const httpUrlSchema = z
  .string()
  .trim()
  .max(500)
  .regex(
    /^https?:\/\/[a-z0-9.-]+(:\d+)?(\/[^\s]*)?$/i,
    'Use a full web address, for example https://github.com/org/repo',
  );

/** Optional text: empty string means "clear it" (stored as null). */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable();

const optionalUrl = () => z.union([z.literal('').transform(() => null), httpUrlSchema]).nullable();

/* ---------- Kit score (pure, shared by API and web) ---------- */

export const KIT_FIELD_KEYS = [
  'promise',
  'behaviours',
  'specs',
  'audiences',
  'neverSay',
  'notBuilt',
  'owner',
  'backup',
  'truthSources',
  'activationEvent',
] as const;
export type KitFieldKey = (typeof KIT_FIELD_KEYS)[number];

export const KIT_FIELD_LABELS: Record<KitFieldKey, string> = {
  promise: 'Promise',
  behaviours: 'Three true behaviours',
  specs: 'A spec behind every behaviour',
  audiences: 'Who it is for',
  neverSay: 'Never say',
  notBuilt: 'Not built yet',
  owner: 'Owner',
  backup: 'Backup',
  truthSources: 'Truth sources',
  activationEvent: 'Activation event',
};

export const kitFieldSchema = z.object({
  key: z.enum(KIT_FIELD_KEYS),
  label: z.string(),
  done: z.boolean(),
});
export type KitField = z.infer<typeof kitFieldSchema>;

export interface KitScoreInput {
  promise: string | null;
  behaviours: { text: string; specRef: string | null }[];
  neverSay: string[];
  notBuilt: { text: string }[];
  audiences: string[];
  activationEvent: string | null;
  truthSources: string[];
  hasOwner: boolean;
  hasBackup: boolean;
}

/** The 10 kit fields ("Kit 6/10"). Every field counts once. */
export function kitFields(input: KitScoreInput): KitField[] {
  const filled = (s: string | null) => Boolean(s && s.trim().length > 0);
  const done: Record<KitFieldKey, boolean> = {
    promise: filled(input.promise),
    behaviours: input.behaviours.filter((b) => filled(b.text)).length >= 3,
    specs: input.behaviours.length > 0 && input.behaviours.every((b) => filled(b.specRef)),
    audiences: input.audiences.length > 0,
    neverSay: input.neverSay.length > 0,
    notBuilt: input.notBuilt.length > 0,
    owner: input.hasOwner,
    backup: input.hasBackup,
    truthSources: input.truthSources.length > 0,
    activationEvent: filled(input.activationEvent),
  };
  return KIT_FIELD_KEYS.map((key) => ({ key, label: KIT_FIELD_LABELS[key], done: done[key] }));
}

export function kitScore(input: KitScoreInput): number {
  return kitFields(input).filter((f) => f.done).length;
}

/* ---------- Products ---------- */

export const productStatsSchema = z.object({
  /** Briefs made for this product this calendar month (stage past `idea`). */
  piecesThisMonth: z.number().int().nonnegative(),
  /** Installs from metric snapshots of this product's posts this calendar month. */
  installsThisMonth: z.number().int().nonnegative(),
});
export type ProductStats = z.infer<typeof productStatsSchema>;

export const productKitSummarySchema = z.object({
  version: z.number().int().positive(),
  score: z.number().int().min(0).max(10),
  promise: z.string().nullable(),
  signedBy: userRefSchema.nullable(),
  signedAt: isoDateTimeSchema.nullable(),
});
export type ProductKitSummary = z.infer<typeof productKitSummarySchema>;

/** One card on the Products screen. Also the item shape of GET /products (product switcher). */
export const productSummarySchema = productSchema.extend({
  kit: productKitSummarySchema.nullable(),
  stats: productStatsSchema,
  /** Platforms this product posts to (from Settings > Channels, else shared accounts). */
  platforms: z.array(platformSchema),
});
export type ProductSummary = z.infer<typeof productSummarySchema>;

export const productDetailSchema = productSummarySchema.extend({
  members: z.array(productMemberSchema),
});
export type ProductDetail = z.infer<typeof productDetailSchema>;

export const productListQuerySchema = paginationQuerySchema.extend({
  status: productStatusSchema.optional(),
  q: z.string().trim().max(80).optional(),
});
export type ProductListQuery = z.infer<typeof productListQuerySchema>;

export const productListResponseSchema = z.object({
  items: z.array(productSummarySchema),
  total: z.number().int().nonnegative(),
});
export type ProductListResponse = z.infer<typeof productListResponseSchema>;

export const createProductRequestSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    slug: productSlugSchema,
    shortName: z.string().trim().min(1).max(24).optional(),
    status: productStatusSchema.default('draft'),
    statusNote: optionalText(80).optional(),
    color: productColorSchema.nullable().optional(),
    repoUrl: optionalUrl().optional(),
    siteUrl: optionalUrl().optional(),
    ownerId: uuidSchema.nullable().optional(),
    backupId: uuidSchema.nullable().optional(),
  })
  .refine((v) => !v.ownerId || !v.backupId || v.ownerId !== v.backupId, {
    message: 'Owner and backup must be different people',
    path: ['backupId'],
  });
export type CreateProductRequest = z.input<typeof createProductRequestSchema>;

export const updateProductRequestSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    shortName: z.string().trim().min(1).max(24),
    status: productStatusSchema,
    statusNote: optionalText(80),
    color: productColorSchema.nullable(),
    repoUrl: optionalUrl(),
    siteUrl: optionalUrl(),
    ownerId: uuidSchema.nullable(),
    backupId: uuidSchema.nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Send at least one field to change' })
  .refine((v) => !v.ownerId || !v.backupId || v.ownerId !== v.backupId, {
    message: 'Owner and backup must be different people',
    path: ['backupId'],
  });
export type UpdateProductRequest = z.input<typeof updateProductRequestSchema>;

/* ---------- Members ---------- */

export const productMemberInputSchema = z.object({
  userId: uuidSchema,
  productRole: productRoleSchema,
});
export type ProductMemberInput = z.infer<typeof productMemberInputSchema>;

/** Replaces the full member list. The named owner and backup must keep their roles. */
export const putProductMembersRequestSchema = z.object({
  members: z
    .array(productMemberInputSchema)
    .max(200)
    .refine(
      (list) => new Set(list.map((m) => `${m.userId}:${m.productRole}`)).size === list.length,
      { message: 'The same person and role appear twice' },
    ),
});
export type PutProductMembersRequest = z.infer<typeof putProductMembersRequestSchema>;

export const productMembersResponseSchema = z.object({
  items: z.array(productMemberSchema),
  total: z.number().int().nonnegative(),
});
export type ProductMembersResponse = z.infer<typeof productMembersResponseSchema>;

/* ---------- Product kit ---------- */

const kitText = (max: number) => z.string().trim().min(1).max(max);

export const updateKitRequestSchema = z.object({
  /** The version you edited. 409 when the kit changed since you loaded it. */
  version: z.number().int().positive(),
  promise: optionalText(300),
  behaviours: z.array(kitBehaviourSchema.extend({ text: kitText(300) })).max(10),
  neverSay: z
    .array(kitText(80))
    .max(100)
    .refine((l) => new Set(l.map((w) => w.toLowerCase())).size === l.length, {
      message: 'A never-say word appears twice',
    }),
  notBuilt: z.array(kitNotBuiltSchema.extend({ text: kitText(300) })).max(30),
  audiences: z.array(kitText(80)).max(30),
  activationEvent: optionalText(200),
  truthSources: z.array(kitText(200)).max(30),
});
export type UpdateKitRequest = z.infer<typeof updateKitRequestSchema>;

export const KIT_CHANGE_STATUSES = ['added', 'modified', 'removed', 'renamed', 'unsigned'] as const;
export const kitChangeStatusSchema = z.enum(KIT_CHANGE_STATUSES);
export type KitChangeStatus = z.infer<typeof kitChangeStatusSchema>;

export const kitSpecChangeSchema = z.object({
  path: z.string(),
  specRef: z.string().nullable(),
  status: kitChangeStatusSchema,
  changedAt: isoDateTimeSchema.nullable(),
  url: z.string().nullable(),
  /** True when a kit behaviour or not-built item cites this spec. */
  citedInKit: z.boolean(),
});
export type KitSpecChange = z.infer<typeof kitSpecChangeSchema>;

export const kitRefreshResultSchema = z.object({
  repo: z.string(),
  checkedAt: isoDateTimeSchema,
  /** Changes since this time (the kit signature). Null when the kit was never signed. */
  since: isoDateTimeSchema.nullable(),
  kitVersion: z.number().int().positive(),
  changes: z.array(kitSpecChangeSchema),
  /** True when the list was cut to the first page of results. */
  truncated: z.boolean(),
});
export type KitRefreshResult = z.infer<typeof kitRefreshResultSchema>;

export const productKitViewSchema = productKitSchema.extend({
  status: z.enum(['draft', 'signed']),
  fields: z.array(kitFieldSchema),
  owner: userRefSchema.nullable(),
  backup: userRefSchema.nullable(),
  /** True when the signed-in user is the named product owner. */
  canSign: z.boolean(),
  canEdit: z.boolean(),
  /** Last "Refresh from repo" result for this product, if any. */
  lastRefresh: kitRefreshResultSchema.nullable(),
});
export type ProductKitView = z.infer<typeof productKitViewSchema>;

/* ---------- Team (users) ---------- */

export const teamMembershipSchema = z.object({
  productId: uuidSchema,
  productName: z.string(),
  productRole: productRoleSchema,
});
export type TeamMembership = z.infer<typeof teamMembershipSchema>;

export const teamMemberSchema = userSchema.extend({
  memberships: z.array(teamMembershipSchema),
  /** Products where this person is the named backup. */
  backupFor: z.array(z.object({ productId: uuidSchema, productName: z.string() })),
});
export type TeamMember = z.infer<typeof teamMemberSchema>;

export const teamListQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(80).optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type TeamListQuery = z.infer<typeof teamListQuerySchema>;

export const teamListResponseSchema = z.object({
  items: z.array(teamMemberSchema),
  total: z.number().int().nonnegative(),
});
export type TeamListResponse = z.infer<typeof teamListResponseSchema>;

export const createUserRequestSchema = z.object({
  email: z
    .email()
    .max(200)
    .transform((v) => v.trim().toLowerCase()),
  name: z.string().trim().min(1).max(80),
  title: optionalText(80).optional(),
  role: roleSchema.default('member'),
  isBrandApprover: z.boolean().default(false),
});
export type CreateUserRequest = z.input<typeof createUserRequestSchema>;

export const createUserResponseSchema = z.object({
  user: teamMemberSchema,
  /** Shown once. The person changes it after the first sign-in. Never stored in plain text. */
  tempPassword: z.string(),
});
export type CreateUserResponse = z.infer<typeof createUserResponseSchema>;

export const updateUserRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    title: optionalText(80),
    role: roleSchema,
    isBrandApprover: z.boolean(),
    isActive: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Send at least one field to change' });
export type UpdateUserRequest = z.infer<typeof updateUserRequestSchema>;

/* ---------- Integrations status ---------- */

/** One social channel row on the Integrations screen (no tokens, ever). */
export const integrationChannelSchema = z.object({
  /** Null when no account exists yet for this platform. */
  id: uuidSchema.nullable(),
  platform: platformSchema,
  displayName: z.string(),
  description: z.string().nullable(),
  handle: z.string().nullable(),
  /** Real state: `connected` only when a token is stored. */
  status: channelStatusSchema,
  /** True when the account has a stored (encrypted) token. */
  hasToken: z.boolean(),
  allowedActions: z.array(channelActionSchema),
  expiresAt: isoDateTimeSchema.nullable(),
  lastError: z.string().nullable(),
  connectedAt: isoDateTimeSchema.nullable(),
  /** True when the server has the app keys for this platform's OAuth flow. */
  oauthConfigured: z.boolean(),
  /** False for WhatsApp (reminder only). */
  canConnect: z.boolean(),
});
export type IntegrationChannel = z.infer<typeof integrationChannelSchema>;

export const integrationToolSchema = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: integrationStatusSchema,
  /** One plain line on why it has this status, for example "ANTHROPIC_API_KEY is set". */
  detail: z.string().nullable(),
});
export type IntegrationTool = z.infer<typeof integrationToolSchema>;

export const integrationsStatusResponseSchema = z.object({
  channels: z.array(integrationChannelSchema),
  tools: z.array(integrationToolSchema),
});
export type IntegrationsStatusResponse = z.infer<typeof integrationsStatusResponseSchema>;
