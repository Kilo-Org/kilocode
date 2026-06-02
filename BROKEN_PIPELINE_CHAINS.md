# BROKEN_PIPELINE_CHAINS.md — PR #10790 (OpenCode v1.14.42 upstream merge)

Compared against: `origin/main`

## Methodology

I traced each Kilo-specific cross-file/cross-layer chain touched by the four flagged shared files plus the gateway TUI type shims:

1. Diffed the four target files (`flag.ts`, `global.ts`, `.opencode/plugins/tui-smoke.tsx`, `.opencode/tui.json`) and the two gateway TUI type files against `origin/main`.
2. For every Kilo flag/global/field added or removed, grepped the whole tree (`.ts`/`.tsx`/`.json`/`.md`, excluding `node_modules`) for **introduce → propagate → consume** sites.
3. Verified the TUI command/keymap migration (`useCommandDialog`/`command.register` → `useCommandPalette`/`useBindings`) end-to-end, confirming the new keymap context actually reads the fields the Kilo registration emits (`namespace`, `name`, `slashName`, `slashAliases`, `title`, `desc`).
4. Checked that renamed module specifiers (`@tui/component/dialog-command` → `@tui/context/command-palette`) resolve to a real export and that no consumer still imports the old path.
5. Confirmed removed interface members (e.g. `ClawAutocompleteRef.onKeyDown`) have no surviving callers.

Note: `flag.ts` and `global.ts` live in `packages/core` (`@opencode-ai/core`); their consumers live in `packages/opencode/src` and import via `@opencode-ai/core/flag/flag` and `@opencode-ai/core/global`. Both chains resolve correctly.

## Findings

**No broken end-to-end chains were found.** Every intermediate step for the Kilo-specific chains touched by this merge is present and consumed.

The closest candidates, all verified intact:

1. **`KILO_EXPERIMENTAL_HTTPAPI` flag removed (`flag.ts`)** — Introduced previously as a channel-gated flag; this merge deletes it (and the `InstallationChannel` import + `HTTPAPI_DEFAULT_ON_CHANNELS` set). Verified there are **zero** remaining references to `KILO_EXPERIMENTAL_HTTPAPI` anywhere in source/config/docs. The Effect-httpapi backend is now the unconditional default and the Kilo httpapi groups (`src/kilocode/server/httpapi/groups/*`) remain wired. **Not broken** — removal is clean, no orphaned consumer.

2. **`Path.repos` global added (`global.ts`)** — Introduced at `packages/core/src/global.ts` (path entry + `ensureRealDir` + `Interface`/`make`). Flows through `@opencode-ai/core/global` → consumed at `packages/opencode/src/util/repository.ts` and `packages/opencode/src/agent/agent.ts` (permission `allow` glob), and exercised by `repo_clone`/`repo_overview` tests. **Chain complete.**

3. **`KILO_EXPERIMENTAL_SCOUT` flag added (`flag.ts`)** — Consumed at `agent/agent.ts` and `tool/registry.ts` (gates `code`, `repo_clone`, `repo_overview` tools) with test coverage. **Chain complete.**

4. **`KILO_ENABLE_PARALLEL` flag added (`flag.ts`)** — Consumed at `tool/registry.ts` and `tool/websearch.ts` (`flags = { ... parallel: Flag.KILO_ENABLE_PARALLEL }`). **Chain complete.**

5. **Gateway TUI type rename `useCommandDialog` → `useCommandPalette`** (`kilo-gateway/src/tui/types.ts`, `kilo-gateway/src/types/tui.d.ts`) — The ambient module was renamed `@tui/component/dialog-command` → `@tui/context/command-palette`. The new module exists and exports `useCommandPalette` at `packages/opencode/src/cli/cmd/tui/context/command-palette.tsx`, and the Kilo injector at `src/kilocode/cli/cmd/tui/app.tsx` was updated to provide `useCommandPalette`. No source still imports the old path. **Chain complete.** (Minor pre-existing observation, *not* introduced by this PR: `TUIDependencies.useCommandPalette` is registered via `initializeTUIDependencies` but never read back through `getTUIDependencies()` in the gateway — the real consumers import `useCommandPalette` directly from `@tui`. This dead plumbing predates the merge.)

6. **Kilo command registration migrated to keymap API** (`src/kilocode/cli/cmd/tui/app.tsx`) — `command.register(() => [{ value, onSelect, slash }])` → `useBindings(() => ({ commands: [{ namespace: "palette", name, slashName, slashAliases, title, desc, run }] }))`. Verified the new command-palette context reads exactly `namespace === "palette"`, `name`, `slashName`, `slashAliases`, `desc`/`title` to build slash entries, so the Kilo `/process` (aliases `/processes`) command and the auto-approve toggle still surface. **No field is set-but-never-read.**

7. **`ClawAutocompleteRef.onKeyDown` removed** (`src/kilocode/claw/autocomplete.tsx`) — Replaced by `useBindings`. Verified the only ref consumer (`src/kilocode/claw/chat.tsx`) uses `auto?.visible` / `auto?.onInput` / `auto?.onCursorChange` only; it never calls `onKeyDown`. **No dangling caller.**

## Non-findings (verified safe, no action needed)

- **`.opencode/tui.json` simplified to `{ "keybinds": {} }`** and **`.opencode/plugins/tui-smoke.tsx` keybind format migrated** (nested `keybinds` → flat command-name → keybind map via `@opentui/keymap`). These are repo-root dev smoke-test scaffolding; `tui-smoke`/`workspace-smoke` are not referenced by any shipped code or test. Not a Kilo product chain.
- **TUI keybind format change does not affect gateway keybindings.** Kilo's real keybindings are registered programmatically via `useBindings` (`app.tsx`, `claw/autocomplete.tsx`), not through the nested `tui.json` plugin keybind block that was removed.
- **`// kilocode_change - new file` markers removed** from `src/kilocode/cli/cmd/tui/app.tsx` and `src/kilocode/claw/autocomplete.tsx`. These paths contain `kilocode`, so markers are not required there; their removal is correct per the merge guidelines and does not affect behavior.
- **`flag.ts` / `global.ts` package location (`packages/core`)** — consumers import via `@opencode-ai/core/*` aliases; all resolved.
