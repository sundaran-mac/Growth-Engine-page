import { PlugsConnected } from '@phosphor-icons/react';
import { OAUTH_PLATFORM_LABELS, type OAuthPlatform } from '@growth-desk/contract';
import { Button, type ButtonProps } from '@/components/atoms/Button';
import { useConnectChannel } from './use-connect-channel';

export interface ConnectChannelButtonProps extends Omit<ButtonProps, 'onClick' | 'loading'> {
  platform: OAuthPlatform;
  /** Connect the accounts to this product only. Omit to share with every product. */
  productId?: string | undefined;
  label?: string;
  /** For tests: where to send the browser. Defaults to window.location.assign. */
  navigate?: (url: string) => void;
}

/**
 * Starts the OAuth connect for Meta, Google or LinkedIn. Used on Integrations (PRODUCTS) and
 * on Publish when a channel is not connected.
 */
export function ConnectChannelButton({
  platform,
  productId,
  label,
  navigate,
  variant = 'secondary',
  size = 'sm',
  ...props
}: ConnectChannelButtonProps) {
  const { connect, isPending } = useConnectChannel(navigate);
  const name = OAUTH_PLATFORM_LABELS[platform];

  return (
    <Button
      variant={variant}
      size={size}
      leftIcon={PlugsConnected}
      loading={isPending}
      onClick={() => connect(platform, productId)}
      aria-label={label ? undefined : `Connect ${name}`}
      {...props}
    >
      {label ?? 'Connect'}
    </Button>
  );
}
