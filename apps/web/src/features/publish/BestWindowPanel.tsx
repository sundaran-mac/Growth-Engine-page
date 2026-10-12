import { PLATFORM_LABELS, type PublishBriefSummary } from '@growth-desk/contract';
import { StatusChip } from '@/components/atoms/StatusChip';
import { Panel } from '@/components/organisms/Panel';

const STARTING_TEXT =
  'Weeks 1 to 4 use the starting rule: reels 6 to 9 am or 7 to 10 pm, audience local time.';

const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

export interface BestWindowPanelProps {
  summary: PublishBriefSummary | undefined;
}

/**
 * "Best windows" on Publish: the starting rule for weeks 1 to 4, then the window learned from
 * our own posts (value per 1k reach) per channel and audience time zone.
 */
export function BestWindowPanel({ summary }: BestWindowPanelProps) {
  const best = summary?.bestWindow;
  const learned = best?.rule === 'learned';
  return (
    <Panel
      tone="sunken"
      className="bg-joy-soft"
      title={<span className="text-base">Best windows</span>}
      actions={
        best ? (
          <StatusChip tone={learned ? 'care' : 'neutral'}>
            {learned ? 'Learned' : 'Starting rule'}
          </StatusChip>
        ) : null
      }
    >
      <p className="text-13">{best?.text ?? STARTING_TEXT}</p>
      {learned && best.windows.length > 0 ? (
        <ul className="flex flex-col gap-1 text-13" aria-label="Best window per channel">
          {best.windows.map((w) => (
            <li key={`${w.platform}-${w.audienceTz}`} className="flex flex-wrap items-center gap-2">
              <span className="font-bold">{PLATFORM_LABELS[w.platform]}</span>
              {w.rule === 'learned' && w.startHour !== null && w.endHour !== null ? (
                <>
                  <span className="font-mono">
                    {hh(w.startHour)} to {hh(w.endHour)}
                  </span>
                  <span className="text-muted">
                    {w.valuePer1kReach} per 1k reach · {w.posts} posts
                  </span>
                  <StatusChip tone="care">learned</StatusChip>
                </>
              ) : (
                <StatusChip tone="neutral">starting</StatusChip>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {summary ? (
        <p className="text-xs text-muted">
          {summary.autoSchedule
            ? 'Auto schedule is on: approved posts take the next free slot. You can still change the time.'
            : 'Auto schedule is off: pick a time for each row, or press Schedule all.'}
        </p>
      ) : null}
    </Panel>
  );
}
