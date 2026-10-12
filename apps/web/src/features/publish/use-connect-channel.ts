import { OAUTH_PLATFORM_LABELS, type OAuthPlatform } from '@growth-desk/contract';
import { toast } from '@/components/ui/sonner';
import { isApiError } from '@/lib/api';
import { useStartOAuth } from './api';
import { toastError } from './toast';

/**
 * The shared connect flow: asks the API for the provider URL and leaves the app for it, or
 * shows one clear toast when it cannot start. Used by `ConnectChannelButton` and by the
 * Integrations "Connect" menu, so there is one copy of this logic.
 */
export function useConnectChannel(navigate?: (url: string) => void) {
  const start = useStartOAuth(navigate);
  const pending = start.isPending ? (start.variables?.platform ?? null) : null;

  function connect(platform: OAuthPlatform, productId?: string) {
    const name = OAUTH_PLATFORM_LABELS[platform];
    start.mutate(
      { platform, productId },
      {
        onError: (error) => {
          if (isApiError(error) && error.code === 'FEATURE_DISABLED') {
            toast.error('Not set up: add keys in .env', {
              description: error.detail ?? `${name} needs its app keys before it can connect.`,
            });
            return;
          }
          toastError(error, `Could not start ${name} connect`);
        },
      },
    );
  }

  return { connect, pending, isPending: start.isPending };
}
