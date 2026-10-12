import { ArrowSquareOut, GitDiff, Plugs } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import type { KitRefreshResult } from '@growth-desk/contract';
import { Button } from '@/components/atoms/Button';
import { Icon } from '@/components/atoms/Icon';
import { StatusChip, type StatusTone } from '@/components/atoms/StatusChip';
import { Panel } from '@/components/organisms/Panel';
import { shortDate } from '../format';

const STATUS_TONE: Record<KitRefreshResult['changes'][number]['status'], StatusTone> = {
  added: 'care',
  modified: 'reminder',
  removed: 'danger',
  renamed: 'reminder',
  unsigned: 'neutral',
};

/** "GitHub not connected" state for Refresh from repo. */
export function GithubNotConnected({ detail }: { detail?: string | undefined }) {
  return (
    <Panel tone="sunken" title="GitHub not connected" titleIcon={<Icon icon={Plugs} size={20} />}>
      <p className="text-sm text-muted">
        {detail ??
          'Refresh from repo reads the product repo through GitHub. Set GITHUB_TOKEN on the server to turn it on.'}
      </p>
      <Button asChild variant="secondary" size="sm" className="self-start">
        <Link to="/integrations">Open Integrations</Link>
      </Button>
    </Panel>
  );
}

/** List of spec files changed since the kit was signed. Nothing changes without a person. */
export function RefreshPanel({ result }: { result: KitRefreshResult }) {
  const since = result.since
    ? `since the kit was signed on ${shortDate(result.since)}`
    : 'the kit is not signed yet, so every spec file is listed';
  return (
    <Panel
      title="From the repo"
      titleIcon={<Icon icon={GitDiff} size={20} />}
      description={`${result.repo} · checked ${shortDate(result.checkedAt)} · ${since}`}
    >
      {result.changes.length === 0 ? (
        <p className="text-sm text-muted">No spec file changed. The kit still matches the repo.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-hairline">
          {result.changes.map((c) => (
            <li key={c.path} className="flex items-center gap-3 py-2">
              <StatusChip tone={STATUS_TONE[c.status]}>
                {c.status === 'unsigned' ? 'to check' : c.status}
              </StatusChip>
              <span className="min-w-0 flex-1 truncate font-mono text-13 text-ink">{c.path}</span>
              {c.citedInKit ? <StatusChip tone="joy">cited in kit</StatusChip> : null}
              {c.url ? (
                <a
                  href={c.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="focus-ring inline-flex items-center gap-1 rounded text-xs font-semibold text-ink underline-offset-2 hover:underline"
                >
                  Open
                  <Icon icon={ArrowSquareOut} size={14} label="opens in a new tab" />
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {result.truncated ? (
        <p className="text-xs text-muted">
          Only the latest changes are listed. Check the repo for older ones.
        </p>
      ) : null}
      {result.changes.length > 0 ? (
        <p className="text-xs text-muted">
          Read the changes, edit the kit if the truth changed, and ask the owner to sign again.
        </p>
      ) : null}
    </Panel>
  );
}
