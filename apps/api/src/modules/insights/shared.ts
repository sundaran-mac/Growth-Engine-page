/**
 * Cross-module functions of the INSIGHTS module. Stub created by the lead with the final
 * signatures; the INSIGHTS agent implements the bodies. SETTINGS' weekly run calls them.
 */
import { writeAudit } from '../../lib/audit.js';
import { generateMondayNote } from './notes.service.js';

export interface MondayNote {
  id: string;
  productId: string;
  weekStart: string;
  doMore: string;
  stop: string;
  summary: string;
}

/** Writes (or returns the existing) Monday note for a product and week. `weekStart` is YYYY-MM-DD. */
export async function writeMondayNote(productId: string, weekStart: string): Promise<MondayNote> {
  const { row, created } = await generateMondayNote(productId, weekStart);
  if (created) {
    await writeAudit({
      actorId: null,
      action: 'note.write',
      entity: 'weekly_note',
      entityId: row.id,
      after: row,
    });
  }
  return {
    id: row.id,
    productId,
    weekStart: row.weekStart,
    doMore: row.doMore ?? '',
    stop: row.stopDoing ?? '',
    summary: row.body,
  };
}
