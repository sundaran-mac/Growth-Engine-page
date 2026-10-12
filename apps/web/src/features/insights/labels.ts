/**
 * Lead labels and small helpers shared by the Sales components.
 */
import type { LeadSource, LeadStage, LeadView } from '@growth-desk/contract';

export const STAGE_LABELS: Record<LeadStage, string> = {
  new: 'New',
  qualified: 'Qualified',
  talking: 'Talking',
  pilot: 'Pilot',
  review: 'Review',
  won: 'Won',
  lost: 'Lost',
};

export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  keyword_reply: 'Keyword reply',
  tracked_link: 'Tracked link',
  dm: 'DM',
  website_form: 'Website form',
  manual: 'Logged by hand',
};

export function sourceLine(lead: Pick<LeadView, 'sourceText' | 'source'>): string {
  return lead.sourceText ?? LEAD_SOURCE_LABELS[lead.source];
}

/** The usual next stage ("Move to Talking"). */
export function nextStageOf(stage: LeadStage): LeadStage | null {
  const order: LeadStage[] = ['new', 'qualified', 'talking', 'pilot', 'review', 'won'];
  const i = order.indexOf(stage);
  return i >= 0 && i < order.length - 1 ? order[i + 1]! : null;
}
