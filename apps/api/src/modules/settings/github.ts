/**
 * Small GitHub REST client for the SETTINGS module (fetch + GITHUB_TOKEN).
 * Used for the weekly pull request and for syncing `docs/specs/**.md` into Knowledge.
 * Every call has a timeout; errors map to stable codes.
 */
import { z } from 'zod';
import { env } from '../../config/env.js';
import { AppError, featureDisabled } from '../../lib/errors.js';

export const GITHUB_API = 'https://api.github.com';
const TIMEOUT_MS = 15_000;
const MAX_BRANCH_TRIES = 10;
/** Upper bound on spec files read in one sync. */
export const MAX_SPEC_FILES = 100;

export function isGithubEnabled(): boolean {
  return env.githubToken !== null;
}

function token(): string {
  if (!env.githubToken)
    throw featureDisabled('GitHub', 'GitHub is not connected (GITHUB_TOKEN is not set).');
  return env.githubToken;
}

export class GithubError extends AppError {
  constructor(
    readonly httpStatus: number,
    detail: string,
    cause?: unknown,
  ) {
    super({ status: 502, code: 'GITHUB_FAILED', title: 'GitHub call failed', detail, cause });
  }
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

async function gh(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
  accept = 'application/vnd.github+json',
): Promise<{ status: number; data: unknown; text: string }> {
  let res: Response;
  try {
    res = await fetch(`${GITHUB_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token()}`,
        Accept: accept,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'growth-desk',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new GithubError(0, 'GitHub did not answer. Try again later.', err);
  }
  const text = await res.text();
  let data: unknown = null;
  if (text && accept.includes('json')) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  return { status: res.status, data, text };
}

function fail(status: number, what: string, data: unknown): never {
  const msg = (data as { message?: unknown } | null)?.message;
  const detail = `${what} (GitHub ${status}${typeof msg === 'string' ? `: ${msg}` : ''}).`;
  if (status === 401 || status === 403) {
    throw new GithubError(status, `GitHub refused the token. ${detail}`);
  }
  if (status === 404) throw new GithubError(status, `Repo or branch not found. ${detail}`);
  throw new GithubError(status, detail);
}

const refSchema = z.object({ object: z.object({ sha: z.string() }) });
const contentShaSchema = z.object({ sha: z.string() });
const pullSchema = z.object({ html_url: z.string(), number: z.number() });
const treeSchema = z.object({
  truncated: z.boolean().optional(),
  tree: z.array(z.object({ path: z.string(), type: z.string(), sha: z.string() })),
});

export async function getBranchSha(repo: string, branch: string): Promise<string> {
  const r = await gh('GET', `/repos/${repo}/git/ref/heads/${encodePath(branch)}`);
  if (r.status !== 200) fail(r.status, `Could not read branch ${branch}`, r.data);
  return refSchema.parse(r.data).object.sha;
}

/** Creates `name`, or `name-2`, `name-3`... when the branch already exists. Returns the name used. */
export async function createBranch(repo: string, name: string, sha: string): Promise<string> {
  for (let i = 1; i <= MAX_BRANCH_TRIES; i += 1) {
    const candidate = i === 1 ? name : `${name}-${i}`;
    const r = await gh('POST', `/repos/${repo}/git/refs`, { ref: `refs/heads/${candidate}`, sha });
    if (r.status === 201) return candidate;
    const msg = (r.data as { message?: unknown } | null)?.message;
    if (r.status === 422 && typeof msg === 'string' && /already exists/i.test(msg)) continue;
    fail(r.status, `Could not create branch ${candidate}`, r.data);
  }
  throw new GithubError(422, `Branches ${name} to ${name}-${MAX_BRANCH_TRIES} already exist.`);
}

/** Creates or replaces one file on a branch. */
export async function putFile(input: {
  repo: string;
  branch: string;
  path: string;
  content: string;
  message: string;
}): Promise<void> {
  const existing = await gh(
    'GET',
    `/repos/${input.repo}/contents/${encodePath(input.path)}?ref=${encodeURIComponent(input.branch)}`,
  );
  const sha = existing.status === 200 ? contentShaSchema.parse(existing.data).sha : undefined;
  const r = await gh('PUT', `/repos/${input.repo}/contents/${encodePath(input.path)}`, {
    message: input.message,
    content: Buffer.from(input.content, 'utf8').toString('base64'),
    branch: input.branch,
    ...(sha ? { sha } : {}),
  });
  if (r.status !== 200 && r.status !== 201) fail(r.status, `Could not write ${input.path}`, r.data);
}

export async function openPullRequest(input: {
  repo: string;
  head: string;
  base: string;
  title: string;
  body: string;
}): Promise<{ url: string; number: number }> {
  const r = await gh('POST', `/repos/${input.repo}/pulls`, {
    title: input.title,
    head: input.head,
    base: input.base,
    body: input.body,
  });
  if (r.status !== 201) fail(r.status, 'Could not open the pull request', r.data);
  const pr = pullSchema.parse(r.data);
  return { url: pr.html_url, number: pr.number };
}

/** Branch, commit one file, open the PR. Returns the PR URL and the branch used. */
export async function createWeeklyPullRequest(input: {
  repo: string;
  base: string;
  branch: string;
  path: string;
  content: string;
  title: string;
  body: string;
}): Promise<{ url: string; branch: string }> {
  const sha = await getBranchSha(input.repo, input.base);
  const branch = await createBranch(input.repo, input.branch, sha);
  await putFile({
    repo: input.repo,
    branch,
    path: input.path,
    content: input.content,
    message: input.title,
  });
  const pr = await openPullRequest({
    repo: input.repo,
    head: branch,
    base: input.base,
    title: input.title,
    body: input.body,
  });
  return { url: pr.url, branch };
}

export interface SpecFile {
  path: string;
  text: string;
  url: string;
}

const SPEC_PATH = /^docs\/specs\/.+\.md$/i;

/** Reads every `docs/specs/**.md` on the branch (at most MAX_SPEC_FILES). */
export async function listSpecFiles(repo: string, branch: string): Promise<SpecFile[]> {
  const tree = await gh('GET', `/repos/${repo}/git/trees/${encodePath(branch)}?recursive=1`);
  if (tree.status !== 200) fail(tree.status, `Could not read the files of ${branch}`, tree.data);
  const paths = treeSchema
    .parse(tree.data)
    .tree.filter((t) => t.type === 'blob' && SPEC_PATH.test(t.path))
    .map((t) => t.path)
    .sort()
    .slice(0, MAX_SPEC_FILES);
  const out: SpecFile[] = [];
  // Small batches keep us polite with the API.
  for (let i = 0; i < paths.length; i += 5) {
    const batch = paths.slice(i, i + 5);
    const files = await Promise.all(
      batch.map(async (path) => {
        const r = await gh(
          'GET',
          `/repos/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`,
          undefined,
          'application/vnd.github.raw+json',
        );
        if (r.status !== 200) fail(r.status, `Could not read ${path}`, r.data);
        return {
          path,
          text: r.text,
          url: `https://github.com/${repo}/blob/${encodePath(branch)}/${encodePath(path)}`,
        };
      }),
    );
    out.push(...files);
  }
  return out;
}
