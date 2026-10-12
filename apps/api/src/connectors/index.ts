/**
 * Connector registry. Add a platform (for example X or Threads) by adding one file that
 * implements `Connector`, then one line here.
 */
import type { Platform } from '@growth-desk/contract';
import { googleOAuth, youtubeConnector } from './google.js';
import { linkedinConnector, linkedinOAuth } from './linkedin.js';
import { facebookConnector, instagramConnector, metaOAuth } from './meta.js';
import type { Connector, OAuthProvider } from './types.js';
import { whatsappConnector } from './whatsapp.js';

const connectors: Record<Platform, Connector> = {
  instagram: instagramConnector,
  facebook: facebookConnector,
  youtube: youtubeConnector,
  linkedin: linkedinConnector,
  whatsapp: whatsappConnector,
};

const providers: Record<OAuthProvider['name'], OAuthProvider> = {
  meta: metaOAuth,
  google: googleOAuth,
  linkedin: linkedinOAuth,
};

export function getConnector(platform: Platform): Connector {
  return connectors[platform];
}

export function getOAuthProvider(name: OAuthProvider['name']): OAuthProvider {
  return providers[name];
}

/** OAuth provider that refreshes tokens for a platform, if any. */
export function providerForPlatform(platform: Platform): OAuthProvider | null {
  if (platform === 'instagram' || platform === 'facebook') return metaOAuth;
  if (platform === 'youtube') return googleOAuth;
  if (platform === 'linkedin') return linkedinOAuth;
  return null;
}

export * from './types.js';
export { instagramPrivateReply } from './meta.js';
