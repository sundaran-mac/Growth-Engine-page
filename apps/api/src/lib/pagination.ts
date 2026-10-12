/**
 * List helpers: `{ items, total }` with `limit` (max 100) and `offset` (BUILD-PLAN section 4).
 */
import {
  paginationQuerySchema,
  type ListResponse,
  type PaginationQuery,
} from '@growth-desk/contract';

export { paginationQuerySchema };
export type { PaginationQuery };

export function parsePagination(query: unknown): PaginationQuery {
  return paginationQuerySchema.parse(query ?? {});
}

export function toListResponse<T>(items: T[], total: number): ListResponse<T> {
  return { items, total };
}

/** Postgres `count(*)` comes back as a string or bigint; turn it into a number. */
export function toCount(value: unknown): number {
  const n = typeof value === 'bigint' ? Number(value) : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}
