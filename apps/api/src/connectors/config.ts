/**
 * Platform API versions and endpoints. Versions move often ("check first"), so they live here.
 */

/** Meta Graph API version used for Facebook Login, Pages and Instagram calls. */
export const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION?.trim() || 'v24.0';
export const META_GRAPH_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
export const META_DIALOG_URL = `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`;

/**
 * LinkedIn REST version header (YYYYMM). Old versions are switched off about a year after
 * release (202510 sunsets 15 Oct 2026), so keep this current.
 */
export const LINKEDIN_API_VERSION = process.env.LINKEDIN_API_VERSION?.trim() || '202609';
export const LINKEDIN_AUTH_URL = 'https://www.linkedin.com/oauth/v2/authorization';
export const LINKEDIN_TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
export const LINKEDIN_API_BASE = 'https://api.linkedin.com';

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
export const YOUTUBE_UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos';

/** YouTube privacy for new uploads. Public by default: both gates approved the piece. */
export const YOUTUBE_PRIVACY = (process.env.YOUTUBE_PRIVACY_STATUS?.trim() || 'public') as
  | 'public'
  | 'unlisted'
  | 'private';

/** A YouTube upload counts as a Short when it is vertical and at most this long. */
export const YOUTUBE_SHORT_MAX_MS = 180_000;
