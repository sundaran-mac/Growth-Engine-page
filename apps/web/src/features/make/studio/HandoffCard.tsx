import { ArrowSquareOut } from '@phosphor-icons/react';
import { Icon } from '@/components/atoms/Icon';
import { ErrorState } from '@/components/molecules/ErrorState';
import { Stagger, StaggerItem } from '@/components/motion';
import { Panel } from '@/components/organisms/Panel';
import { Skeleton } from '@/components/ui/skeleton';
import { useHandoffTools } from '../api';

/** "Hand off to a tool" (Figma 241:1171): links open the outside tool in a new tab. */
export function HandoffCard() {
  const tools = useHandoffTools();
  return (
    <Panel title={<span className="text-base">Hand off to a tool</span>} className="min-w-0 flex-1">
      {tools.isPending ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : tools.isError ? (
        <ErrorState
          error={tools.error}
          onRetry={() => void tools.refetch()}
          retrying={tools.isFetching}
        />
      ) : (
        <Stagger as="ul" className="flex flex-col gap-3">
          {tools.data.items.map((tool) => (
            <StaggerItem as="li" key={tool.key} className="flex items-center gap-2">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-13 font-semibold text-ink">{tool.name}</span>
                <span className="text-xs text-muted">{tool.description}</span>
              </div>
              {tool.url ? (
                <a
                  href={tool.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="focus-ring inline-flex items-center gap-1 rounded-sm text-xs font-semibold text-joy-text hover:underline"
                  aria-label={`Open ${tool.name} in a new tab`}
                >
                  Open
                  <Icon icon={ArrowSquareOut} size={14} />
                </a>
              ) : (
                <span className="text-xs text-muted">Not set up</span>
              )}
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </Panel>
  );
}
