/**
 * Auth contract: login, session user and the `/auth/me` response.
 * Owned by FOUNDATION-API.
 */
import { z } from 'zod';
import { uuidSchema } from './common.js';
import { productRoleSchema, roleSchema } from './enums.js';

export const SESSION_COOKIE_NAME = 'gd_session';

export const loginRequestSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email('Enter a valid email')),
  password: z.string().min(1, 'Enter your password').max(256),
});
export type LoginRequest = z.input<typeof loginRequestSchema>;

export const sessionUserSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  email: z.email(),
  /** Two letters for the avatar, for example `JS`. */
  initials: z.string(),
  /** Short role line under the name, for example `Marketing · Design`. */
  title: z.string().nullable(),
  role: roleSchema,
  isBrandApprover: z.boolean(),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

export const membershipSchema = z.object({
  productId: uuidSchema,
  productRole: productRoleSchema,
});
export type Membership = z.infer<typeof membershipSchema>;

export const meResponseSchema = z.object({
  user: sessionUserSchema,
  memberships: z.array(membershipSchema),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

/** `POST /auth/login` returns the same body as `GET /auth/me`. */
export const loginResponseSchema = meResponseSchema;
export type LoginResponse = MeResponse;
