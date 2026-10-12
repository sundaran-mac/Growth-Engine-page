# Visual pass rules (12 Oct 2026, Sundaran: "exactly same as Figma", smooth animations)

Branch `growth-desk-ui-polish`, working tree /Users/sundaranv/Desktop/Growth-Engine-page. No git commands.
5 agents work at the same time. Edit ONLY the files you own (listed in your prompt).
Shared kit (`apps/web/src/components/**`, `app/**`, `styles/**`, `tailwind.config.ts`, `lib/**`) belongs to V-KIT only.
If you need a shared change, build a local version in your feature folder and list it in your report.

## How to compare
1. Figma file `sUxvEcixtr0XhtgLdNhWZU`. Load the Skill `figma:figma-design-to-code` before `get_design_context`.
   Use `get_screenshot` (maxDimension 1440) and `get_design_context` on your frames and their sub-frames
   for exact sizes, paddings, gaps, radii, font sizes and weights, colours.
2. Your screen: `node e2e/scripts/shot.mjs <route> <out.png> [role]` against the live dev server
   http://localhost:5173 (hot reload, real API and seed data). Roles: jeeva (editor), elan (admin, brand),
   liveowner (owner of Humini Live). Save shots in your own scratch folder, not in the repo.
3. Look at both images side by side (Read the PNG). List every difference. Fix. Shoot again. Repeat until
   they match. Data differs (seed vs Figma sample): match layout, spacing, type and colour, not numbers.
4. Also check 1280 px wide (resize in the script by editing a copy in your scratch folder) so nothing
   breaks on a laptop.

## Animation rules (library `motion`, already installed; shared pieces in `@/components/motion`)
- Use `Stagger` + `StaggerItem` for lists of cards and rows, `MotionCard` for clickable cards,
  `FadeIn` for panels that load. Use `motion/react` `AnimatePresence` + `layout` for items that are
  added, removed or moved (for example Kanban moves, ideas starred, comments added).
- Durations from `DURATION` and easing `EASE`. Nothing longer than 0.35 s. No bounce on data.
  Never animate on every re-render or refetch: only on mount, add, remove, move.
- Respect reduced motion (MotionProvider does it; do not override).
- Skeletons for loading are kept; content fades in after.
- Page transition and the sliding sidebar pill already exist (do not add another page transition).

## Quality
- Keep every existing test green; update a test only when the markup really changed, never weaken it.
- `npm run test -w @growth-desk/web`, `npm run typecheck -w @growth-desk/web`, `npx eslint <your files>`.
- No em-dash. Accessible: keep labels, roles and focus rings.
- Report under 40 lines: screens matched, differences fixed, animations added, anything you could not
  match and why, shared-kit requests.
