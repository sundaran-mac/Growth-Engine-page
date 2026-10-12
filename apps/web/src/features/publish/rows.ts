/** Row rules for the Publish table (pure, shared by the page, the table and the tests). */
import type { PostView } from '@growth-desk/contract';
import { EDITABLE_STATUSES } from './format';

export type RowAction = 'edit' | 'post-now' | 'retry' | 'cancel' | 'download' | 'mark-posted';

/** Which row actions a post allows. Pure, so the page and the tests agree. */
export function rowActions(post: PostView, gateAllowed: boolean): RowAction[] {
  const actions: RowAction[] = [];
  if (EDITABLE_STATUSES.has(post.status)) actions.push('edit');
  if (
    gateAllowed &&
    post.how === 'auto' &&
    (post.status === 'draft' || post.status === 'scheduled')
  ) {
    actions.push('post-now');
  }
  if (post.status === 'failed') actions.push('retry');
  if (post.status === 'scheduled' || post.status === 'manual_pending') actions.push('cancel');
  if (post.how === 'reminder' && post.assetId) actions.push('download');
  if (post.status === 'manual_pending') actions.push('mark-posted');
  return actions;
}

/** Audience zones offered in the picker. The post's own zone is always added. */
export const AUDIENCE_ZONES = [
  { tz: 'Asia/Kolkata', label: 'India (IST)' },
  { tz: 'Asia/Singapore', label: 'Singapore (SGT)' },
  { tz: 'Asia/Dubai', label: 'Gulf (GST)' },
  { tz: 'Asia/Colombo', label: 'Sri Lanka' },
  { tz: 'Asia/Kuala_Lumpur', label: 'Malaysia' },
  { tz: 'Europe/London', label: 'United Kingdom' },
  { tz: 'America/New_York', label: 'US East' },
] as const;
