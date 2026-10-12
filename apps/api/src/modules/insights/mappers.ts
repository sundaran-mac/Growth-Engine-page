/**
 * Row to DTO mapping for INSIGHTS responses.
 */
import { alias } from 'drizzle-orm/pg-core';
import type { Lead, LeadActivity, Notification, UserRef, WeeklyNote } from '@growth-desk/contract';
import {
  users,
  type leadActivities,
  type leads,
  type notifications,
  type weeklyNotes,
} from '../../db/schema/index.js';
import { iso } from '../../lib/time.js';

type LeadRow = typeof leads.$inferSelect;
type LeadActivityRow = typeof leadActivities.$inferSelect;
type NotificationRow = typeof notifications.$inferSelect;
type WeeklyNoteRow = typeof weeklyNotes.$inferSelect;

export const ownerUsers = alias(users, 'owner_user');
export const actorUsers = alias(users, 'actor_user');

export const userRefColumns = (t: typeof users) => ({
  id: t.id,
  name: t.name,
  initials: t.initials,
});

export function toUserRef(
  u: { id: string | null; name: string | null; initials: string | null } | null | undefined,
): UserRef | null {
  if (!u || !u.id || u.name === null || u.initials === null) return null;
  return { id: u.id, name: u.name, initials: u.initials };
}

export function toLead(row: LeadRow, owner: UserRef | null): Lead {
  return {
    id: row.id,
    productId: row.productId,
    organisation: row.organisation,
    source: row.source,
    sourcePostId: row.sourcePostId,
    sourceText: row.sourceText,
    who: row.who,
    firstOffer: row.firstOffer,
    owner,
    ownerNote: row.ownerNote,
    stage: row.stage,
    nextStep: row.nextStep,
    nextStepAt: iso(row.nextStepAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toLeadActivity(row: LeadActivityRow, actor: UserRef | null): LeadActivity {
  return {
    id: row.id,
    leadId: row.leadId,
    actor,
    kind: row.kind,
    body: row.body,
    fromStage: row.fromStage,
    toStage: row.toStage,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    link: row.link,
    readAt: iso(row.readAt),
    createdAt: row.createdAt.toISOString(),
  };
}

export function toWeeklyNote(row: WeeklyNoteRow): WeeklyNote {
  return {
    id: row.id,
    productId: row.productId,
    weekStart: row.weekStart,
    body: row.body,
    doMore: row.doMore,
    stopDoing: row.stopDoing,
    createdAt: row.createdAt.toISOString(),
  };
}

const EM_DASH_RE = new RegExp(`\\s*${String.fromCharCode(0x2014)}\\s*`, 'g');

/** No em-dash characters anywhere (house rule): Claude text is cleaned before it is stored. */
export function cleanText(text: string): string {
  return text.replace(EM_DASH_RE, ', ').replace(/\s+/g, ' ').trim();
}
