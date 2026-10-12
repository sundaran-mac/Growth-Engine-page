# @growth-desk/contract

Zod schemas, enums and inferred types shared by `apps/api` and `apps/web`.

## How it resolves

`package.json` `exports` has three conditions:

| Condition     | File            | Who uses it                                                       |
| ------------- | --------------- | ----------------------------------------------------------------- |
| `types`       | `src/index.ts`  | TypeScript (editor, `tsc`)                                        |
| `development` | `src/index.ts`  | Vite dev server and Vitest, `tsx` with `--conditions=development` |
| `default`     | `dist/index.js` | Node in production and Docker, Vite production build              |

So run `npm run build -w @growth-desk/contract` before a production build. The root
`build`, `typecheck` and `dev` scripts do this first.

## Ownership

Only FOUNDATION-API edits files here, except `src/modules/<module>.ts`, which belong to the
module agent named in the file header.
