// Integrations and team screen (Figma frame 242:1642).
// Connect and disconnect use PUBLISH's shared pieces (ConnectChannelButton, useConnectChannel,
// useDisconnectChannel), so the OAuth start and its error toasts live in one place.
import { CaretDown, Plus } from '@phosphor-icons/react';
import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  OAUTH_PLATFORM_LABELS,
  PLATFORM_OAUTH,
  type IntegrationChannel,
  type OAuthPlatform,
  type Platform,
} from '@growth-desk/contract';
import { Button } from '@/components/atoms/Button';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import { ErrorState } from '@/components/molecules/ErrorState';
import { Stagger } from '@/components/motion';
import { Page } from '@/components/templates/Page';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSessionStore } from '@/stores/session';
import { useIntegrationsStatus } from '@/features/products/api';
import {
  IntegrationCard,
  IntegrationCardSkeleton,
} from '@/features/products/components/IntegrationCard';
import { TeamPanel } from '@/features/products/components/TeamPanel';
import {
  CHANNEL_STATUS_VIEW,
  DEFAULT_TOOL_ICON,
  PLATFORM_ICONS,
  TOOL_ICONS,
  TOOL_STATUS_VIEW,
  toastArgs,
} from '@/features/products/format';
import { ConnectChannelButton, useConnectChannel, useDisconnectChannel } from '@/features/publish';

/** The OAuth provider that connects a channel platform; null for WhatsApp (by hand). */
function oauthFor(platform: Platform): OAuthPlatform | null {
  return PLATFORM_OAUTH[platform];
}

export default function IntegrationsPage() {
  const query = useIntegrationsStatus();
  const { connect, pending } = useConnectChannel();
  const disconnect = useDisconnectChannel();
  // Same rule as the API (connect and disconnect need admin or editor).
  const canManage = useSessionStore((s) => s.user?.role === 'admin' || s.user?.role === 'editor');
  const [toDisconnect, setToDisconnect] = React.useState<IntegrationChannel | null>(null);
  const [params, setParams] = useSearchParams();

  // Result of the OAuth round trip (PUBLISH redirects back here with a query string).
  React.useEffect(() => {
    const error = params.get('error');
    const connected = params.get('connected') ?? params.get('platform');
    if (!error && !connected) return;
    if (error) toast.error('Could not connect', { description: params.get('message') ?? error });
    else toast.success(`${connected} connected`);
    void query.refetch();
    setParams({}, { replace: true });
  }, [params, setParams, query]);

  async function confirmDisconnect() {
    if (!toDisconnect?.id) return;
    try {
      await disconnect.mutateAsync(toDisconnect.id);
      toast.success(`${toDisconnect.displayName} disconnected`, {
        description: 'The stored tokens were removed.',
      });
    } catch (error) {
      toast.error(...toastArgs(error));
      throw error;
    }
  }

  const channels = query.data?.channels ?? [];
  const providers = [
    ...new Set(
      channels
        .filter((c) => c.canConnect)
        .map((c) => oauthFor(c.platform))
        .filter((p): p is OAuthPlatform => p !== null),
    ),
  ];

  return (
    <Page
      title="Integrations and team"
      subtitle="What Growth Desk connects to, and who can do what"
      actions={
        canManage && providers.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button leftIcon={Plus} rightIcon={CaretDown} loading={pending !== null}>
                Connect
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {providers.map((p) => (
                <DropdownMenuItem key={p} onSelect={() => connect(p)}>
                  {OAUTH_PLATFORM_LABELS[p]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null
      }
    >
      {query.isPending ? (
        <ul
          className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
          aria-busy="true"
          aria-label="Loading integrations"
        >
          {Array.from({ length: 6 }, (_, i) => (
            <IntegrationCardSkeleton key={i} />
          ))}
        </ul>
      ) : query.isError ? (
        <ErrorState
          error={query.error}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      ) : (
        <Stagger
          as="ul"
          className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
          aria-label="Integrations"
        >
          {query.data.channels.map((c) => {
            const view = CHANNEL_STATUS_VIEW[c.status];
            const provider = oauthFor(c.platform);
            const note =
              c.status === 'error' && c.lastError
                ? c.lastError
                : c.hasToken && c.handle
                  ? c.handle
                  : c.canConnect && !c.oauthConfigured && provider
                    ? `Not set up: add the ${OAUTH_PLATFORM_LABELS[provider]} app keys in .env.`
                    : null;
            const showConnect =
              canManage && c.canConnect && provider !== null && c.status !== 'connected';
            const showDisconnect = canManage && c.id !== null && c.hasToken;
            return (
              <IntegrationCard
                key={c.id ?? c.platform}
                icon={PLATFORM_ICONS[c.platform]}
                name={c.displayName}
                description={c.description}
                statusLabel={view.label}
                statusTone={view.tone}
                note={note}
                actions={
                  showConnect || showDisconnect ? (
                    <>
                      {showConnect && provider ? (
                        <ConnectChannelButton
                          platform={provider}
                          label={c.status === 'error' ? 'Reconnect' : 'Connect'}
                          disabled={pending !== null}
                        />
                      ) : null}
                      {showDisconnect ? (
                        <Button size="sm" variant="ghost" onClick={() => setToDisconnect(c)}>
                          Disconnect
                        </Button>
                      ) : null}
                    </>
                  ) : null
                }
              />
            );
          })}
          {query.data.tools.map((t) => {
            const view = TOOL_STATUS_VIEW[t.status];
            return (
              <IntegrationCard
                key={t.key}
                icon={TOOL_ICONS[t.key] ?? DEFAULT_TOOL_ICON}
                name={t.name}
                description={t.description}
                statusLabel={view.label}
                statusTone={view.tone}
                note={t.detail}
              />
            );
          })}
        </Stagger>
      )}

      <TeamPanel />

      <ConfirmDialog
        open={toDisconnect !== null}
        onOpenChange={(o) => (o ? undefined : setToDisconnect(null))}
        title={`Disconnect ${toDisconnect?.displayName ?? ''}?`}
        description="Growth Desk removes the stored tokens. Scheduled posts on this channel will not go out until you connect again."
        confirmLabel="Disconnect"
        tone="danger"
        onConfirm={confirmDisconnect}
      />
    </Page>
  );
}
