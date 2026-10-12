/**
 * Server-side fetch of a user-given URL with an SSRF guard.
 *
 * - http and https only, no credentials in the URL.
 * - The host is resolved first; every address must be public unicast (ipaddr.js range
 *   `unicast`). Private, loopback, link-local, carrier NAT, multicast, reserved and
 *   unique-local ranges are blocked, IPv4-mapped IPv6 included.
 * - The connection uses the address that passed the check (pinned `lookup`), so a DNS answer
 *   that changes between check and connect (rebinding) cannot reach an internal host.
 * - Redirects are followed by hand (at most 3) and each hop is checked again.
 * - 10 s for the whole fetch, 5 MB body limit (stops reading at the limit).
 */
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import ipaddr from 'ipaddr.js';
import { AppError } from '../../lib/errors.js';

export const FETCH_TIMEOUT_MS = 10_000;
export const FETCH_MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;

export type Resolver = (hostname: string) => Promise<LookupAddress[]>;

const systemResolver: Resolver = (hostname) =>
  new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses) =>
      err ? reject(err) : resolve(addresses),
    );
  });

let resolver: Resolver = systemResolver;

/** Test hook: swap the DNS resolver (pass null to restore the system one). */
export function setResolverForTests(fake: Resolver | null): void {
  resolver = fake ?? systemResolver;
}

const blocked = (detail: string) =>
  new AppError({ status: 422, code: 'URL_NOT_ALLOWED', title: 'Address not allowed', detail });

/** True only for public unicast addresses. */
export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  let parsed = ipaddr.parse(address);
  if (parsed.kind() === 'ipv6') {
    const v6 = parsed as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) parsed = v6.toIPv4Address();
  }
  return parsed.range() === 'unicast';
}

export interface SafeFetchResult {
  url: string;
  status: number;
  contentType: string | null;
  body: Buffer;
}

async function checkedAddress(hostname: string): Promise<LookupAddress> {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (ipaddr.isValid(host)) {
    if (!isPublicAddress(host)) throw blocked('This address points to a private network.');
    return { address: host, family: host.includes(':') ? 6 : 4 };
  }
  let addresses: LookupAddress[];
  try {
    addresses = await resolver(host);
  } catch {
    throw new AppError({
      status: 422,
      code: 'URL_NOT_REACHABLE',
      title: 'Address not found',
      detail: 'This web address could not be found.',
    });
  }
  if (addresses.length === 0 || addresses.some((a) => !isPublicAddress(a.address))) {
    throw blocked('This address points to a private network.');
  }
  return addresses[0]!;
}

function validateUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw blocked('This is not a valid web address.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw blocked('Only http and https addresses are allowed.');
  }
  if (url.username || url.password) throw blocked('Addresses with a user name are not allowed.');
  return url;
}

function requestOnce(
  url: URL,
  pinned: LookupAddress,
  signal: AbortSignal,
  maxBytes: number,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  const lookup: LookupFunction = (_hostname, options, callback) => {
    if ((options as { all?: boolean }).all) {
      (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, [pinned]);
    } else {
      callback(null, pinned.address, pinned.family);
    }
  };
  const client = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(
      url,
      {
        method: 'GET',
        lookup,
        signal,
        headers: {
          'User-Agent': 'GrowthDesk/1.0 (+knowledge fetch)',
          Accept: 'text/html, text/plain, text/markdown, application/pdf, */*;q=0.5',
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          resolve({ status, headers: res.headers, body: Buffer.alloc(0) });
          return;
        }
        const declared = Number(res.headers['content-length'] ?? NaN);
        if (Number.isFinite(declared) && declared > maxBytes) {
          res.destroy();
          reject(tooLarge(maxBytes));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            res.destroy();
            reject(tooLarge(maxBytes));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end();
  });
}

const tooLarge = (maxBytes: number) =>
  new AppError({
    status: 422,
    code: 'URL_TOO_LARGE',
    title: 'Page too large',
    detail: `The page is larger than ${Math.round(maxBytes / (1024 * 1024))} MB.`,
  });

export async function safeFetch(
  rawUrl: string,
  opts: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<SafeFetchResult> {
  const signal = AbortSignal.timeout(opts.timeoutMs ?? FETCH_TIMEOUT_MS);
  const maxBytes = opts.maxBytes ?? FETCH_MAX_BYTES;
  let url = validateUrl(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const pinned = await checkedAddress(url.hostname);
    let res;
    try {
      res = await requestOnce(url, pinned, signal, maxBytes);
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (signal.aborted) {
        throw new AppError({
          status: 422,
          code: 'URL_TIMEOUT',
          title: 'Page too slow',
          detail: 'The page did not answer within 10 seconds.',
        });
      }
      throw new AppError({
        status: 422,
        code: 'URL_NOT_REACHABLE',
        title: 'Page not reachable',
        detail: 'The page could not be fetched.',
        cause: err,
      });
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.location;
      if (!location) break;
      url = validateUrl(new URL(location, url).toString());
      continue;
    }
    if (res.status < 200 || res.status >= 300) {
      throw new AppError({
        status: 422,
        code: 'URL_NOT_REACHABLE',
        title: 'Page not reachable',
        detail: `The page answered with status ${res.status}.`,
      });
    }
    const ct = res.headers['content-type'];
    return {
      url: url.toString(),
      status: res.status,
      contentType: typeof ct === 'string' ? ct.split(';')[0]!.trim().toLowerCase() : null,
      body: res.body,
    };
  }
  throw new AppError({
    status: 422,
    code: 'URL_NOT_REACHABLE',
    title: 'Too many redirects',
    detail: 'The page redirected too many times.',
  });
}
