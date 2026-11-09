# Port the VS Code Marketplace UI to v2

Branch `marketplace-panel` from `origin/v2`; PR target `v2`; title `feat(vscode): port the marketplace panel to v2`. No changesets.

## Goal

Bring main's Marketplace panel to the v2 extension as a native client of the `kilocode.marketplace` RPC: browse the catalog, install, inspect installed records, repair, uninstall, and complete MCP sign-in. Port the visual UI from main and rewrite its data layer; do not port main's host `MarketplaceService`.

## Decisions

- **Scope (user-confirmed):** v2 subset plus management. Kinds are `agent`, `skill`, `mcp`. Drop plugin items, relevance/suggested-item entry points, the agent-migration banner, telemetry and the busy-session warning.
- **Placement:** rung 2 (Kilo-owned `packages/kilo-vscode`). No shared upstream file, seam or `kilocode_change` entry. The server RPC already exists in `kilo-plugin/src/marketplace`, so no server work.
- **Panel:** one editor tab `Kilo Marketplace`, opened by `kilo-code.v2.marketplace`, reusing the `settings` webview bundle through `editorPanel` with a new `marketplace` root view. Main's separate panel bundle is not needed.
- **Data:** the webview calls `v2.api.rpc(KiloMarketplaceRpc.Definition)` over the relay with `{ location: { directory } }`, the pattern already used by `v2/mcp.ts` and the Settings Skills/Agents tabs. The host only opens the panel, relays, and opens external links.
- **Installed records are first class:** the `installed` RPC is loaded separately from the catalog, so a failed catalog still leaves installs manageable. Records with no catalog item appear under the `Installed` status filter.
- **MCP safety:** call `preview` before an MCP install, show the config file, redacted server config, parameters and the plaintext-secret warning, then require confirmation. Skills and agents show kind-specific warnings instead.
- **MCP sign-in:** reuse `createMcp()` from `v2/mcp.ts` for status, sign-in and cancel. After an MCP install, poll the server up to ~15s for the new server; if it reports `needs_auth`, offer inline sign-in.
- **i18n:** reuse the existing `marketplace.*` keys in `packages/kilo-i18n/src/*` (all locales are already present). Add only new English keys to `packages/kilo-i18n/src/en.ts`; other locales fall back to English per `packages/ui/AGENTS.md`.

## Contract facts to build against

- `list({ kind, refresh?, query? })` returns `{ items, failures }`; items carry `registry, kind, id, name, description, category?, author?, url?, tags, prerequisites, parameters, options, agent?`.
- `installed({})` returns `Installed` records: `registry, kind, id, scope, project?, config?, server?, resources?, recovering?, status?: ready|missing|modified|incomplete, warnings?, pending?, installedAt`.
- `preview({ registry, kind, id, scope, option?, params? })` is MCP-only and returns `{ config, server, parameters, secrets }` with secrets redacted.
- `install` takes `{ registry, kind, id, scope, option?, params? }` and returns the `Installed` record. Options and shared parameters merge with option parameters winning.
- `uninstall` takes `{ registry, kind, id, scope }`, removes only owned resources, and keeps shared MCP sign-in.
- RPC failures are thrown as `{ type, message }`, not `Error`; normalize before display.

## Tasks

1. **Host panel**
   - Add `packages/kilo-vscode/src/marketplace-panel.ts`: single `editorPanel` with type `kilo-code.v2.marketplacePanel`, title `Kilo Marketplace`, `view: "marketplace"`; export `open` and `dispose`.
   - Add the panel to `src/extension.ts` beside the Settings/Profile panels and register `kilo-code.v2.marketplace`.
   - Widen `editorPanel`'s `view` union in `src/editor-panel.ts` and add an optional `globals` passthrough to its `wire({...})` call.
   - In `src/chat.ts`: add `marketplace` to `View`, to `VIEW_SETTING_KEYS` (empty set), and map `ENTRY.marketplace = "settings"`; treat it as an ES-module panel in `html()` and give it the editor background. Handle `openMarketplace` in `handleLeafMessage` by executing the new command.
   - Pass `KILO_HAS_WORKSPACE` (from `workspace.workspaceFolders`) through the panel's `globals` so the install dialog can hide project scope without a workspace.
   - In `package.json`: add the activation event `onWebviewPanel:kilo-code.v2.marketplacePanel`, the command (`Marketplace`, icon `$(extensions)`), and a `view/title` entry at `navigation@3` between Agent Manager and Profile.

2. **Webview data layer**
   - Add `webview-ui/src/v2/marketplace-data.ts` (JSX- and context-free): signals for `items`, `records`, catalog loading, inventory loading, errors and inventory error; `load(refresh)`, `refreshInstalled()`, `preview()`, `install()`, `uninstall()`; helpers `recordsFor(registry, kind, id)`, `scopesFor()`, `needsRepair(record)` and `mergeParameters(item, option)`. Use `Promise.allSettled` per kind and keep the two failure boundaries separate.
   - Add `webview-ui/src/v2/marketplace.ts`: `createMarketplace()` composing `useV2()`, `createMcp()` and the data module; load on connect and on mount; abort in-flight requests on cleanup.

3. **Components (same paths and names as v1 where they port)**
   - Add `webview-ui/src/components/marketplace/`: `MarketplaceView.tsx`, `MarketplaceListView.tsx`, `ItemCard.tsx`, `InstallModal.tsx`, `RemoveDialog.tsx`, `MarketplaceContribute.tsx`, `utils.ts`, `marketplace.css`, `index.ts`.
   - List: search, status (`All`, `Installed`, `Not installed`), kind chips, category chips, Refresh, per-kind error banners and a separate inventory error banner.
   - Cards accept a normalized entry `{ item?, record?, records }`: name, kind tag, registry or author, description (3-line clamp with expand), category, scope/status badges, warnings, and actions.
   - Actions: Install when absent; Repair when `missing`/`incomplete`/`recovering`; Reinstall where the server permits; Remove per scope; Sign In for an installed MCP whose status is `needs_auth`. Modified records show a "local changes protected" note.
   - Install dialog: scope radio (project hidden without `KILO_HAS_WORKSPACE`), MCP method select, merged parameter fields (secret fields masked), prerequisites and kind warnings; MCP preview step; result step with record warnings and inline MCP sign-in; refresh inventory on success.
   - Remove dialog: kind and scope confirmation, retain-sign-in note for MCP, server error surfaced when modified resources refuse removal.
   - Keep the contribute footer and docs links; open links with `v2.open(url, true)`.

4. **Entry points**
   - `v2/SettingsApp.tsx`: widen its `view` prop to include `marketplace` and add `Match when={props.view === "marketplace"}` rendering the panel.
   - `v2/slash-actions.ts` and `v2/session-view.tsx`: add a `marketplace` slash action (`sidebar.topBar.marketplace` description) posting `{ type: "openMarketplace" }`; add the message to `protocol.ts`.
   - `McpSubtab.tsx`: add a "Browse Marketplace" button (`settings.agentBehaviour.mcpBrowseMarketplace`) in the empty state and header that posts `openMarketplace`.

5. **Cleanup rules**
   - Do not add v1-style comments ("as in main/v1"). Put the v1 reference in the PR body only.
   - Add `// kilo_port(vscode:<cell-id>)` on the Kilo-owned code that carries a v1 cell. For renamed modules (host provider, `services/marketplace/*`, `context/marketplace-session.tsx`, `types/marketplace.ts`), add `ported` dispositions with the v2 path and symbol.
   - Mark the v1 `relevance` filter, plugin kind, migration banner, telemetry and busy-session warning as dropped with evidence (main-only concepts with no v2 authority), not "not ported yet".

## Tests and verification

- `packages/kilo-vscode/test/marketplace-utils.test.ts`: search/filter/status/kind/category behavior, record join by `registry|kind|id`, scope ordering, repair predicate, parameter merge (option wins), duplicate ids across registries.
- `packages/kilo-vscode/test/marketplace-data.test.ts`: one failing kind keeps the other kinds and surfaces that failure; installed failure is independent; install/uninstall refresh records; `{type,message}` errors normalize.
- `packages/kilo-vscode/test/marketplace-render.test.ts` + `test/fixtures/marketplace-render.tsx`: fixture-driven render of the list with catalog items and installed records, following `browser-panel-render`.
- Update `test/webview-surface.test.ts`: `marketplace` loads the module bundle, uses `strict-dynamic`, and keeps the editor background.
- From `packages/kilo-vscode`: `bun typecheck`, `bun test test/marketplace-*.test.ts test/webview-surface.test.ts`, then `bun run build`. From the root: `bun run check`.
- Self-test with `bun run extension --fresh` in a temporary workspace: open `/marketplace`, browse three kinds, install a project-scoped skill, verify the card shows Installed and the files land under the workspace, uninstall, and verify removal. Then install an MCP item and complete or cancel sign-in. Never install global scope into the user's real config during self-test.
- PR proof: v1 and v2 screenshots of the same marketplace state (v1 from a main worktree with an isolated home), plus the `### Visual` animated SVG required for a user-facing `feat` PR. Include `## Placement` (rung 2) and `## Progress map` sections and the `bun script/upstream/progress.ts --list vscode` delta; do not commit generated map files.

## Risks and open edges

- MCP config hot-reload is asynchronous; the post-install sign-in step must poll `mcp.list` and time out to a clear message instead of hanging.
- A record whose kind/id is absent from the catalog must remain removable and repairable.
- Installing an agent grants instructions and permissions; always show `agent.permissions` and `agent.mode` before install.
- Secrets are stored in plaintext in MCP config; the preview warning is mandatory, and project scope must advise keeping the file out of git.
- Removing a marketplace-owned skill/agent from Settings leaves a record that the panel reports as missing/incomplete; repair is the recovery path.
- Out of scope: relevance suggestions, notification deep links, plugin items, telemetry, and install-while-session-busy warning.
