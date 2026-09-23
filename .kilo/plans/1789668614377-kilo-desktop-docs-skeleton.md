# Kilo Desktop docs skeleton (DESK-2847)

## Goal

Hand-write the first version of the **Kilo Desktop** documentation section in `packages/kilo-docs`, fully wired into nav/config/llms.txt, on the branch `docs/kilo-desktop`. The branch is **held unmerged until launch** — merging to `main` publishes to the live public site at kilo.ai/docs. The Vercel `docs-staging` preview deploy on each push makes the section reviewable/shareable without being public.

Reference diff: PR #6818 (KiloClaw top-level section promotion). Parent epic: DESK-2846 (Stage 1 = this work; Stage 2 = docs-sync automation, out of scope here).

## Context / assumptions

- Branch `docs/kilo-desktop` already created off synced `main` (`de7dc52c7c`).
- Content source of truth = the Kilo Desktop repo cloned at `/Users/mmurphy/repos/agentic-desktop` (NOT in this monorepo) plus user SME. Do not invent behavior.
  - Trust `agentic-desktop/CONTEXT.md` + the actual `plugins/` and `apps/web/src/features/` trees over `agentic-desktop/README.md`'s "Not yet implemented" list, which is **stale** (it claims chat integration and auth don't exist, but `kilo-ui` and `auth` are present).
- This is a **skeleton**: short stub pages, structurally complete, factually grounded, expandable later.
- Screenshots are the user's responsibility and added later. **v1 ships no `{% image %}` tags.**
- Docs-only change → no changeset required. Held unmerged.

## Confirmed feature inventory (from `agentic-desktop/plugins/` + `apps/web/src/features/`)

Eight discoverable capabilities → subsections on a single Features page:
Notebooks (`notebook`, nteract) · In-app browser (`browser`) · Terminal (`terminal`) · Git integration (`git`) · Local inference (`local-inference`) · Environments (`environments`) · Files (`files`) · Anaconda MCP (`anaconda-mcp`).

Not standalone Features subsections: Chat/workspaces (`kilo-ui`) → Overview + Quickstart; the harness (`kilo-server`, Kilo CLI packaging + server lifecycle) → Overview "how it works"; Authentication (`auth`) → Settings.

## Page / route map (7 pages)

| Nav group | Page | Route | File |
|---|---|---|---|
| Introduction | Overview | `/desktop` | `pages/desktop/overview.md` (index redirect target) |
| Introduction | Installation | `/desktop/installation` | `pages/desktop/installation.md` |
| Introduction | Quickstart | `/desktop/quickstart` | `pages/desktop/quickstart.md` |
| Discover | What you can ask | `/desktop/what-you-can-ask` | `pages/desktop/what-you-can-ask.md` |
| Discover | Features | `/desktop/features` | `pages/desktop/features.md` |
| Configuration | Settings | `/desktop/settings` | `pages/desktop/settings.md` |
| Help | Troubleshooting | `/desktop/troubleshooting` | `pages/desktop/troubleshooting.md` |

Default label in nav: **"Desktop"**. (Note existing inconsistency: SideNav uses "AI Gateway", TopNav uses "Kilo Gateway" for the same section — pick "Desktop" in both; adjust if the user prefers "Kilo Desktop".)

## Implementation tasks (ordered)

Requires an implementation-capable agent (source edits). All paths under `packages/kilo-docs/`.

1. **Create page content** under `pages/desktop/` — seven `.md` files per the map above. Each file:
   - Frontmatter with `title` (sentence case) and `description`.
   - Body: short stub. Use `##` headings (sentence case), second person, present tense, active voice per `STYLE_GUIDE.md`.
   - Crosslink between Desktop pages and to existing docs using absolute `/docs/...` paths, no `.md` extension.
   - **No `{% image %}` tags.** Use `{% callout %}` / `{% tabs %}` only if balanced (see content-integrity test).
   - `features.md`: one `##` subsection per the eight capabilities. Verify "model catalog" home against `agentic-desktop` source (likely part of `local-inference` or chat model selection) before documenting it; do not invent a location.
   - `what-you-can-ask.md`: compact table mapping intent → example prompt → capability/feature it triggers (links to the matching Features subsection).
   - `overview.md`: what Kilo Desktop is (Electron/React agentic chat app), that it runs on the Kilo harness (`kilo-server`), and where to go next.

2. **`lib/nav/desktop.ts`** — new file exporting `DesktopNav: NavSection[]` with groups Introduction / Discover / Configuration / Help and links per the map. Model after `lib/nav/gateway.ts`.

3. **`lib/nav/index.ts`** — import `DesktopNav` and add it to the `Nav` object.

4. **`components/SideNav.tsx`**
   - Add `desktop: Nav.DesktopNav` to `sectionNavItems`.
   - Add `{ label: "Desktop", href: "/desktop", sectionKey: "desktop" }` to `mainNavItems` (place adjacent to Gateway).

5. **`components/TopNav.tsx`** — add `{ label: "Desktop", href: "/desktop" }` to `mainNavItems` (adjacent to Kilo Gateway).

6. **`next.config.js`** — add to the `redirects()` array an index redirect:
   `{ source: "/desktop", destination: "/desktop/overview", basePath: false, permanent: true }`.
   (Do NOT touch `previous-docs-redirects.js` — no pages are being moved/removed.)

7. **`pages/api/llms.txt.ts`** — add `{ title: "Desktop", nav: Nav.DesktopNav }` to the hardcoded `navGroups` array, else the section is absent from llms.txt.

8. **`lychee.toml`** — only if any not-yet-public Kilo Desktop external URL (e.g. a download link) is referenced, add it to the `exclude` array with a comment. Prefer avoiding non-live external URLs in the skeleton.

## Validation (run from repo root; acceptance criteria)

- `bun run --filter @kilocode/kilo-docs build`
- `bun run --filter @kilocode/kilo-docs test` (includes `content-integrity.test.ts`, `sitemap.test.ts`)
- `bun run script/check-md-table-padding.ts` (no padded tables)
- Typecheck: `bun turbo typecheck --filter=@kilocode/kilo-docs` (or repo `bun run typecheck`)
- `docs-check-links` (lychee) passes.
- Manual: `bun run --filter @kilocode/kilo-docs dev` (http://localhost:3002) — verify `/desktop` redirects to `/desktop/overview`, section renders, and is navigable from both top nav and side nav. Confirm `/docs/llms.txt` includes the Desktop group.
- Confirm the Vercel `docs-staging` preview renders the section on push.

## Risks / gotchas

- Missing any of the 7 wiring points → section partially wired (e.g., pages reachable by URL + in llms.txt but absent from nav, or vice versa). All seven are required.
- Any `/docs/img/...` reference without a matching file fails `content-integrity.test.ts` → keep v1 image-free.
- Unbalanced `{% callout %}`/`{% tab %}`/`{% tabs %}` tags fail the same test.
- Padded markdown tables fail CI → use compact single-space tables.
- Accidental merge to `main` publishes to production — branch must stay unmerged until launch.

## Open items (need user/process input; non-blocking for skeleton)

- **Merge owner**: acceptance criteria require a named owner responsible for merging on launch day. User to name.
- **Docs-owner review**: per `.github/docs-sync/surfaces.json`, current owner is `lambertjosh` (intentionally-left-nil for unrouted paths). Route review accordingly.
- **Top-nav label**: default "Desktop"; switch to "Kilo Desktop" if preferred.
- **"Model catalog"** exact home in KD source — resolve during content writing.

## Out of scope

- docs-sync automation / `surfaces.json` source-repo wiring (sibling story, DESK-2846 Stage 2).
- Polished screenshots (user-owned, added later).
- Merging the branch.
