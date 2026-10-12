/**
 * One interface for every social platform. Each platform file implements `Connector` and
 * declares what it can do in `capabilities`, so X or Threads can be added later as one file.
 */
import type { ChannelAction, Platform, Ratio } from '@growth-desk/contract';

/** Stable connector error codes (subset of the publish module codes). */
export type ConnectorErrorCode =
  | 'NOT_CONNECTED'
  | 'NEEDS_APPROVAL'
  | 'MEDIA_NOT_PUBLIC'
  | 'NO_MEDIA'
  | 'UNSUPPORTED_FORMAT'
  | 'OAUTH_EXCHANGE_FAILED'
  | 'OAUTH_NO_ACCOUNTS'
  | 'PLATFORM_AUTH_FAILED'
  | 'PLATFORM_RATE_LIMITED'
  | 'PLATFORM_TIMEOUT'
  | 'PLATFORM_ERROR';

export class ConnectorError extends Error {
  readonly code: ConnectorErrorCode;
  /** HTTP status from the platform, when there was one. */
  readonly httpStatus: number | null;

  constructor(code: ConnectorErrorCode, message: string, opts: { httpStatus?: number | null; cause?: unknown } = {}) {
    super(message, { cause: opts.cause });
    this.name = 'ConnectorError';
    this.code = code;
    this.httpStatus = opts.httpStatus ?? null;
  }
}

export function isConnectorError(err: unknown): err is ConnectorError {
  return err instanceof ConnectorError;
}

/** How the platform receives the media file. */
export type MediaTransfer =
  /** The platform downloads the file from a public URL (Instagram, Facebook). */
  | 'pull_url'
  /** We send the bytes (YouTube, LinkedIn). */
  | 'push_bytes'
  /** Nobody uploads: a person posts by hand (WhatsApp). */
  | 'manual';

export interface ConnectorCapabilities {
  /** Can post through an API at all. */
  publish: boolean;
  video: boolean;
  image: boolean;
  mediaTransfer: MediaTransfer;
  /** Ratios the platform takes well, first is preferred. */
  ratios: readonly Ratio[];
  metrics: boolean;
  privateReply: boolean;
  /** Caption size limit in characters. */
  maxCaptionLength: number;
  /** Links in the caption are clickable. */
  clickableLinks: boolean;
}

/** Decrypted credentials of one channel account. Never leaves the server. */
export interface AccountCredentials {
  /** Platform id of the account (IG user id, Page id, YouTube channel id, LinkedIn URN). */
  externalAccountId: string;
  accessToken: string;
  allowedActions: readonly ChannelAction[];
}

export interface PublishMedia {
  kind: 'video' | 'image';
  /** Presigned GET URL of the file in storage. */
  url: string;
  mimeType: string;
  sizeBytes: number | null;
  durationMs: number | null;
  ratio: Ratio | null;
  fileName: string | null;
}

export interface PublishInput {
  account: AccountCredentials;
  media: PublishMedia;
  caption: string;
  /** Title for platforms that need one (YouTube). */
  title: string;
}

export interface PublishResult {
  externalId: string;
  liveUrl: string | null;
}

/** Lifetime totals for one post, as far as the platform reports them. */
export interface PostMetrics {
  reach: number | null;
  saves: number | null;
  shares: number | null;
  comments: number | null;
  clicks: number | null;
}

export interface Connector {
  readonly platform: Platform;
  readonly capabilities: ConnectorCapabilities;
  publish(input: PublishInput): Promise<PublishResult>;
  /** Throws `UNSUPPORTED_FORMAT` when `capabilities.metrics` is false. */
  fetchMetrics(input: { account: AccountCredentials; externalId: string }): Promise<PostMetrics>;
}

/** One account found after an OAuth connect. */
export interface DiscoveredAccount {
  platform: Platform;
  externalAccountId: string;
  displayName: string;
  handle: string | null;
  description: string;
  status: 'connected' | 'needs_approval';
  allowedActions: ChannelAction[];
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scopes: string[];
}

/** OAuth side of one provider (meta, google, linkedin). */
export interface OAuthProvider {
  readonly name: 'meta' | 'google' | 'linkedin';
  readonly supportsPkce: boolean;
  /** Feature flag: false when the client id or secret is not set. */
  isConfigured(): boolean;
  buildAuthUrl(input: { state: string; redirectUri: string; codeChallenge: string | null }): string;
  exchangeCode(input: { code: string; redirectUri: string; codeVerifier: string | null }): Promise<TokenSet>;
  discoverAccounts(tokens: TokenSet): Promise<DiscoveredAccount[]>;
  /** Present when the provider gives refresh tokens. */
  refresh?(refreshToken: string): Promise<TokenSet>;
}
