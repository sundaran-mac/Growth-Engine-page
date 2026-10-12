/**
 * Small GitHub REST client for "Refresh from repo" (kit.refresh).
 * Reads the product repo's `docs/specs` folder and lists spec files that changed since a time.
 * Every call has a timeout, every response is checked with zod, every failure has a stable code.
 */
import { z } from 'zod';
import type { KitSpecChange } from '@growth-desk/contract';
import { AppError } from '../../lib/errors.js';

export const GITHUB_API = 'https://api.github.com';
export const SPECS_DIR = 'docs/specs';
/** Commits read per refresh. Older changes are reported as truncated. */
export const MAX_COMMITS = 20;
const TIMEOUT_MS = 10_000;

export interface RepoRef {
  owner: string;
  name: string;
}

const REPO_PART = /^[A-Za-z0-9_.-]+$/;

/**
 * `https://github.com/org/repo(.git)`, `github.com/org/repo/tree/main` or `org/repo`.
 * Returns null for anything that is not a GitHub repo.
 */
export function parseGithubRepo(value: string | null | undefined): RepoRef | null {
  if (!value) return null;
  const v = value.trim();
  let path: string;
  const m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/(.+)$/i.exec(v);
  if (m) path = m[1]!;
  else if (/^[^/\s]+\/[^/\s]+$/.test(v)) path = v;
  else return null;
  const [owner, rawName] = path.split('/');
  const name = rawName?.replace(/\.git$/i, '');
  if (!owner || !name || !REPO_PART.test(owner) || !REPO_PART.test(name)) return null;
  return { owner, name };
}

/** `006` from `docs/specs/006-hearts.md`, `013-02` from `docs/specs/013-02-reels.md`. */
export function specRefFromPath(path: string): string | null {
  const file = path.split('/').pop() ?? '';
  const m = /^(\d{3})(?:[-_](\d{2})(?=[-_.]))?/.exec(file);
  if (!m) return null;
  return m[2] ? `${m[1]}-${m[2]}` : m[1]!;
}

const commitListSchema = z.array(
  z.object({
    sha: z.string(),
    html_url: z.string().optional(),
    commit: z.object({
      committer: z.object({ date: z.string().nullable().optional() }).nullable().optional(),
      author: z.object({ date: z.string().nullable().optional() }).nullable().optional(),
    }),
  }),
);

const commitDetailSchema = z.object({
  sha: z.string(),
  html_url: z.string().optional(),
  commit: z.object({
    committer: z.object({ date: z.string().nullable().optional() }).nullable().optional(),
  }),
  files: z
    .array(
      z.object({
        filename: z.string(),
        status: z.string(),
        previous_filename: z.string().optional(),
        blob_url: z.string().nullable().optional(),
      }),
    )
    .default([]),
});

const treeSchema = z.object({
  tree: z.array(z.object({ path: z.string(), type: z.string() })),
  truncated: z.boolean().optional(),
});

function githubError(status: number, detail: string, code = 'GITHUB_FAILED'): AppError {
  return new AppError({ status, code, title: 'GitHub request failed', detail });
}

async function getJson(path: string, token: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${GITHUB_API}${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'growth-desk',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (cause) {
    throw new AppError({
      status: 502,
      code: 'GITHUB_UNREACHABLE',
      title: 'GitHub request failed',
      detail: 'GitHub did not answer in time. Try again later.',
      cause,
    });
  }
  if (res.status === 401) {
    throw githubError(502, 'GitHub refused the token. Check GITHUB_TOKEN.', 'GITHUB_AUTH_FAILED');
  }
  if (res.status === 404) {
    throw githubError(
      422,
      'The repo or its docs/specs folder was not found, or the token cannot read it.',
      'REPO_NOT_FOUND',
    );
  }
  if (res.status === 403 || res.status === 429) {
    throw githubError(503, 'GitHub rate limit reached. Try again later.', 'GITHUB_RATE_LIMITED');
  }
  if (!res.ok) throw githubError(502, `GitHub answered with status ${res.status}.`);
  try {
    return (await res.json()) as unknown;
  } catch (cause) {
    throw new AppError({
      status: 502,
      code: 'GITHUB_FAILED',
      title: 'GitHub request failed',
      detail: 'GitHub sent an answer we could not read.',
      cause,
    });
  }
}

function parseOrFail<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw githubError(502, 'GitHub sent an answer we could not read.');
  return r.data;
}

const enc = encodeURIComponent;

export interface SpecChangesResult {
  changes: Omit<KitSpecChange, 'citedInKit'>[];
  truncated: boolean;
}

/** Spec files changed in `docs/specs` since `since` (newest change per file). */
export async function listSpecChangesSince(
  repo: RepoRef,
  since: Date,
  token: string,
): Promise<SpecChangesResult> {
  const base = `/repos/${enc(repo.owner)}/${enc(repo.name)}`;
  const list = parseOrFail(
    commitListSchema,
    await getJson(
      `${base}/commits?path=${enc(SPECS_DIR)}&since=${enc(since.toISOString())}&per_page=${MAX_COMMITS + 1}`,
      token,
    ),
  );
  const truncated = list.length > MAX_COMMITS;
  const byPath = new Map<string, Omit<KitSpecChange, 'citedInKit'>>();
  // The list is newest first, so the first time we see a path is its latest change.
  for (const c of list.slice(0, MAX_COMMITS)) {
    const detail = parseOrFail(
      commitDetailSchema,
      await getJson(`${base}/commits/${enc(c.sha)}`, token),
    );
    const changedAt = detail.commit.committer?.date ?? null;
    for (const f of detail.files) {
      if (!f.filename.startsWith(`${SPECS_DIR}/`)) continue;
      if (byPath.has(f.filename)) continue;
      const status =
        f.status === 'added' || f.status === 'removed' || f.status === 'renamed'
          ? f.status
          : 'modified';
      byPath.set(f.filename, {
        path: f.filename,
        specRef: specRefFromPath(f.filename),
        status,
        changedAt: changedAt ? new Date(changedAt).toISOString() : null,
        url: detail.html_url ?? f.blob_url ?? null,
      });
    }
  }
  return {
    changes: [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path)),
    truncated,
  };
}

/** Every spec file on the branch (used when the kit was never signed). */
export async function listSpecFiles(
  repo: RepoRef,
  branch: string,
  token: string,
): Promise<SpecChangesResult> {
  const base = `/repos/${enc(repo.owner)}/${enc(repo.name)}`;
  const tree = parseOrFail(
    treeSchema,
    await getJson(`${base}/git/trees/${enc(branch)}?recursive=1`, token),
  );
  const changes = tree.tree
    .filter((t) => t.type === 'blob' && t.path.startsWith(`${SPECS_DIR}/`))
    .map((t) => ({
      path: t.path,
      specRef: specRefFromPath(t.path),
      status: 'unsigned' as const,
      changedAt: null,
      url: `https://github.com/${repo.owner}/${repo.name}/blob/${branch}/${t.path}`,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return { changes, truncated: Boolean(tree.truncated) };
}
