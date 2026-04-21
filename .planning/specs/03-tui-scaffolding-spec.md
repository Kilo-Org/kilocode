# Spec: Phase 3 — TUI Scaffolding — Hybrid Interaction Primitives

## 1. Purpose

Phase 3 ships the reusable interaction primitives that every later TUI view
(Phases 4–5) and the VS Code webview (Phase 9) consume: command palette,
help overlay, footer action bar, paste-mode modal, central keybinding registry
with Ctrl+X leader support, prompt history, and keyboard-navigable tabs.

The user selected the **Clean** architecture: a new platform-agnostic
`packages/devil-keybind/` package for pure command/keybind logic, plus a new
`primitives/` directory + RenderTarget adapter layer inside `packages/devil-ui/`.
This avoids the trap where "TUI primitives" calcify inside `src/devilcode/
workflow-tui/` and then have to be re-implemented for the VS Code webview in
Phase 9 (the "zero duplication" goal).

Phase 3 is **scaffolding only**: it wires the new primitives into the export
surfaces of `devil-ui` and `devil-keybind`, and registers a handful of sample
commands so the palette is usable in a Storybook demo. **Phase 3 does NOT
replace the 8 existing `workflow-tui/` files — that is Phase 5.**

## 2. Scope

### In scope

- New package `packages/devil-keybind/` (Zod schemas, registry, matcher, leader-chain scoping).
- New `packages/devil-ui/src/primitives/` directory: `command-palette/`, `help-overlay/`, `footer-bar/`, `paste-modal/`.
- New `packages/devil-ui/src/context/render-target.tsx` provider + `RenderTarget` interface.
- New `packages/devil-ui/src/adapters/terminal.ts` and `packages/devil-ui/src/adapters/dom.ts`.
- New hooks `use-command-registry.ts`, `use-prompt-history.ts` in `packages/devil-ui/src/hooks/`.
- Storybook stories that render each primitive under both terminal and DOM targets.
- Playwright visual regression snapshots for the DOM target of each primitive.
- Unit tests (Bun native runner) for devil-keybind registry, matcher, scoping, leader chains.
- Minimal integration: a **single** `WorkflowCommandRegistryProvider` wrapper added to
  `packages/opencode/src/devilcode/workflow-tui/index.tsx` that exposes the new
  registry alongside the existing `useCommandDialog` — they COEXIST, no rewrite.

### Out of scope (explicitly)

- Replacement of the 8 existing `workflow-tui/` files. That is **Phase 5**.
- Team Builder views / position picker / roster table. That is **Phase 4**.
- VS Code webview integration (imports from devil-ui/devil-keybind). That is **Phase 9**.
- Migration of existing `useKeybind` consumers to the new registry. Existing
  `packages/opencode/src/cli/cmd/tui/context/keybind.tsx` stays untouched;
  the new registry layers ON TOP of it, not replaces it.
- New command implementations (beyond a handful of demo commands for
  storybook + the escape-to-back command already in workflow-tui).
- Keybinding user-customization UI (Phase 10 polish).

## 3. Deliverables

| # | Path | Kind | LOC | Purpose |
|---|------|------|-----|---------|
| D1  | `packages/devil-keybind/package.json` | new | ~40 | Workspace package manifest (`@devilcode/keybind`) |
| D2  | `packages/devil-keybind/tsconfig.json` | new | ~15 | TS config extending root |
| D3  | `packages/devil-keybind/src/schemas.ts` | new | ~120 | Zod: `CommandScope`, `Command`, `Keybind`, `CommandRegistry`, `KeybindRegistry` |
| D4  | `packages/devil-keybind/src/registry.ts` | new | ~140 | Command + Keybind registries: `register`, `unregister`, `getAllByScope`, `search`, `matchEvent` |
| D5  | `packages/devil-keybind/src/matcher.ts` | new | ~90 | fuzzysort wrapper; scoring by title/aliases/hideKeywords |
| D6  | `packages/devil-keybind/src/leader.ts` | new | ~80 | Ctrl+X leader chain state machine + timeout reset (2 s, matching existing TUI behavior) |
| D7  | `packages/devil-keybind/src/index.ts` | new | ~20 | Barrel export |
| D8  | `packages/devil-keybind/test/registry.test.ts` | new | ~100 | Unit tests: register/unregister, scope filter, duplicate id rejection |
| D9  | `packages/devil-keybind/test/matcher.test.ts` | new | ~70 | Fuzzy search ordering, hideKeywords, empty query |
| D10 | `packages/devil-keybind/test/leader.test.ts` | new | ~60 | Leader chain activation, timeout, nested key, reset on escape |
| D11 | `packages/devil-ui/src/context/render-target.tsx` | new | ~90 | `RenderTarget` interface + `RenderTargetProvider` + `useRenderTarget()` |
| D12 | `packages/devil-ui/src/adapters/terminal.ts` | new | ~110 | OpenTUI adapter: `box`, `text`, `measure`, `focus`; requires `@opentui/solid` peer dep |
| D13 | `packages/devil-ui/src/adapters/dom.ts` | new | ~110 | DOM adapter: native elements styled via Tailwind |
| D14 | `packages/devil-ui/src/adapters/index.ts` | new | ~10 | Adapter barrel |
| D15 | `packages/devil-ui/src/hooks/use-command-registry.ts` | new | ~70 | SolidJS hook; subscribes to a `CommandRegistry` instance; returns `register`, `entries`, `search` |
| D16 | `packages/devil-ui/src/hooks/use-prompt-history.ts` | new | ~80 | Up/Down history navigation; pluggable persistence |
| D17 | `packages/devil-ui/src/primitives/command-palette/index.tsx` | new | ~180 | Ctrl+K palette using `useCommandRegistry` + RenderTarget |
| D18 | `packages/devil-ui/src/primitives/help-overlay/index.tsx` | new | ~140 | `?` overlay; groups commands by scope |
| D19 | `packages/devil-ui/src/primitives/footer-bar/index.tsx` | new | ~110 | 3–5 context-relevant actions; single-key shortcuts |
| D20 | `packages/devil-ui/src/primitives/paste-modal/index.tsx` | new | ~100 | `/paste` or keybind-triggered modal |
| D21 | `packages/devil-ui/src/primitives/index.ts` | new | ~15 | Primitives barrel |
| D22 | `packages/devil-ui/src/stories/primitives/command-palette.stories.tsx` | new | ~90 | Terminal + DOM stories |
| D23 | `packages/devil-ui/src/stories/primitives/help-overlay.stories.tsx` | new | ~70 | Terminal + DOM stories |
| D24 | `packages/devil-ui/src/stories/primitives/footer-bar.stories.tsx` | new | ~70 | Terminal + DOM stories |
| D25 | `packages/devil-ui/src/stories/primitives/paste-modal.stories.tsx` | new | ~70 | Terminal + DOM stories |
| D26 | `packages/devil-ui/tests/primitives-visual.spec.ts` | new | ~80 | Playwright visual regression for DOM target |
| D27 | `packages/devil-ui/package.json` | modified | +12 lines | Add `primitives/*`, `adapters/*`, `hooks/*`, `context/render-target` exports; add `@devilcode/keybind` dep; add `fuzzysort` dep; add `@opentui/solid` peer dep |
| D28 | `packages/devil-ui/src/hooks/index.ts` | modified | +4 lines | Export the two new hooks |
| D29 | `packages/devil-ui/src/context/index.ts` | modified | +2 lines | Export `RenderTargetProvider` + `useRenderTarget` |
| D30 | `packages/opencode/src/devilcode/workflow-tui/index.tsx` | modified | +8 lines | Wrap `WorkflowViewInner` in `RenderTargetProvider` (terminal) + `WorkflowCommandRegistryProvider`; no other changes |
| D31 | `packages/opencode/package.json` | modified | +1 line | Add `@devilcode/keybind: workspace:*` |
| D32 | Root `package.json` workspaces | modified | +1 line | Register `packages/devil-keybind` |

**Total estimated LOC: ~1,660** (matches Clean proposal budget).

## 4. Schema Definitions

All schemas live in `packages/devil-keybind/src/schemas.ts`.

```ts
import { z } from "zod"

export const CommandScope = z.enum([
  "global",
  "workflow",
  "team-builder",
  "review",
])
export type CommandScope = z.infer<typeof CommandScope>

export const Keybind = z.object({
  /** Canonical string form, e.g. "ctrl+k" or "<leader> p" (matches existing util/keybind parser). */
  binding: z.string().min(1),
  /** True if this binding participates in the Ctrl+X leader chain. */
  leader: z.boolean().default(false),
})
export type Keybind = z.infer<typeof Keybind>

// NOTE: Zod 4.1.8 (root catalog pin) removed the `.returns()` fluent API on
// `z.function()`. Instead of runtime-validating function shapes (Zod can't
// truly validate a function body anyway), we define the Zod schema for the
// serializable subset and EXTEND the inferred type with TS-only function
// fields. Runtime guards (typeof cmd.onSelect === "function") check the rest.
export const CommandData = z.object({
  id: z.string().min(1),                 // stable, unique across scopes
  title: z.string().min(1),              // visible in palette
  description: z.string().optional(),
  scope: CommandScope,
  aliases: z.array(z.string()).default([]),
  hideKeywords: z.array(z.string()).default([]),  // searchable, not rendered
  keybind: Keybind.optional(),
  /** Hide from palette. Still matchable via keybind. */
  hidden: z.boolean().default(false),
})
export type CommandData = z.infer<typeof CommandData>

/** Full command type = Zod-validated data + TS-only function fields. */
export interface Command extends CommandData {
  /** Predicate; evaluated at render time. Not Zod-validated. */
  enabled?: () => boolean
  /** Callback. Receives optional context payload from the palette host. */
  onSelect?: (ctx?: unknown) => void | Promise<void>
}

/** Runtime registry; not persisted. */
export interface CommandRegistry {
  register(cmd: Command): () => void          // returns unregister
  unregister(id: string): void
  get(id: string): Command | undefined
  getAllByScope(scope: CommandScope): Command[]
  search(query: string, scope?: CommandScope): Command[]
  /**
   * Subscribe to registry mutations (register/unregister). Returns an unsubscribe
   * function. Required so SolidJS consumers (use-command-registry hook) can
   * reactively track `entries` without polling.
   */
  subscribe(listener: () => void): () => void
}

export interface KeybindRegistry {
  /** Matches a parsed key event (ParsedKey-compatible shape) against registered commands. */
  matchEvent(evt: {
    name: string
    ctrl: boolean
    meta: boolean
    shift: boolean
    super?: boolean
    leader: boolean
  }, scope: CommandScope): Command | undefined
}
```

`RenderTarget.Context` (in `packages/devil-ui/src/context/render-target.tsx`):

```ts
import type { Accessor } from "solid-js"

export type RenderTargetKind = "terminal" | "dom"

export interface RenderTargetAdapter {
  kind: RenderTargetKind
  /** Measures a string in cells (terminal) or pixels (DOM). Used by help-overlay layout. */
  measure(text: string): { width: number; height: number }
  /**
   * Declarative focus contract. Primitives write to `setFocusedNodeId(id | null)`;
   * terminal adapter passes the current value into OpenTUI's JSX `focused={...}` prop
   * (there is NO imperative focus-by-id API in @opentui/solid), DOM adapter uses an
   * effect to call `document.getElementById(id)?.focus()`. This matches the reactive
   * signal pattern both renderers already expect.
   */
  focusedNodeId: Accessor<string | null>
  setFocusedNodeId(id: string | null): void
  /** True if the adapter supports native fuzzy search feedback (DOM only). */
  supportsRichHighlight: boolean
}
```

**Critical contract note (cycle-2 refine)**: `@opentui/solid` does NOT expose an imperative `focus(nodeId)` function. Focus is a declarative JSX prop (`<input focused={isSelected()} />`). Primitives render their focusable elements with `focused={focusedNodeId() === "palette-input"}` (or equivalent) — the adapter is just the signal plumbing.

## 5. Package Structure

```
packages/devil-keybind/
├── package.json          # name: @devilcode/keybind, type: module, zero runtime deps except zod + fuzzysort
├── tsconfig.json
├── src/
│   ├── index.ts          # barrel
│   ├── schemas.ts        # Command, Keybind, CommandScope, registry interfaces
│   ├── registry.ts       # in-memory impls of CommandRegistry + KeybindRegistry
│   ├── matcher.ts        # fuzzysort wrapper: searchCommands(query, commands) -> ranked
│   └── leader.ts         # Ctrl+X leader state + 2 s timeout
└── test/
    ├── registry.test.ts
    ├── matcher.test.ts
    └── leader.test.ts

packages/devil-ui/src/
├── adapters/
│   ├── terminal.ts       # uses @opentui/core measure, @opentui/solid focus
│   ├── dom.ts            # uses canvas-measure for text, HTMLElement.focus
│   └── index.ts
├── context/
│   └── render-target.tsx # new (in addition to existing context/)
├── hooks/
│   ├── use-command-registry.ts
│   └── use-prompt-history.ts
├── primitives/
│   ├── command-palette/
│   │   └── index.tsx
│   ├── help-overlay/
│   │   └── index.tsx
│   ├── footer-bar/
│   │   └── index.tsx
│   ├── paste-modal/
│   │   └── index.tsx
│   └── index.ts
└── stories/primitives/   # 4 new story files
```

## 6. RenderTarget Adapter Contract

`RenderTargetProvider` accepts a `RenderTargetAdapter` and exposes it via
`useRenderTarget()`. Primitives call the hook and branch on `adapter.kind`
at the smallest possible boundary — typically wrapping the root element in
either `<box>` (terminal) or `<div>` (DOM).

The contract is deliberately minimal: we do NOT abstract JSX. Primitives
import both JSX runtimes and pick the right one via a tiny `<Surface>` helper
exported from `adapters/index.ts`:

```tsx
// adapters/index.ts
export function Surface(props: { kind: RenderTargetKind; children: JSXElement; ... }) {
  return props.kind === "terminal"
    ? <box {...terminalProps}>{props.children}</box>
    : <div {...domProps}>{props.children}</div>
}
```

Terminal adapter **peer-depends** on `@opentui/solid` — it is NOT a regular
dep (keeps bundle size off the DOM target and prevents double-registration
of the OpenTUI renderer singleton). Hosts import from
`@devilcode/kilo-ui/adapters/terminal` only when they run under OpenTUI.

## 7. Integration Surface (Consumption)

Phase 3 touches `packages/opencode/` in exactly two places:

1. `packages/opencode/package.json` — add `"@devilcode/keybind": "workspace:*"`.
2. `packages/opencode/src/devilcode/workflow-tui/index.tsx` — wrap the existing
   `WorkflowViewInner` tree in `<RenderTargetProvider adapter={terminalAdapter}>`
   and `<WorkflowCommandRegistryProvider>` from `@devilcode/kilo-ui/primitives`
   so the new registry is available for Phase 5 without disturbing the current
   `useCommandDialog` / `useKeybind` plumbing. No other workflow-tui files
   are edited.

The existing `packages/opencode/src/util/keybind.ts` and
`packages/opencode/src/cli/cmd/tui/context/keybind.tsx` are **not modified**.
devil-keybind's `binding` string format is a superset of util/keybind's parser
output — Phase 5 will introduce a shared parser, but Phase 3 just re-implements
it in devil-keybind (accepting minor duplication as the cost of coexistence).

No `devilcode_change` markers required: devil-keybind and devil-ui are
entirely-Kilo packages (exempted per CLAUDE.md), and the single
workflow-tui/index.tsx edit is already inside `src/devilcode/`.

## 8. Testing Strategy

### Unit (Bun native runner) — devil-keybind

- `registry.test.ts`: register returns unregister fn; duplicate id throws;
  `getAllByScope` filters correctly; `search("pla", "workflow")` respects scope.
- `matcher.test.ts`: fuzzy ranking matches expected order; hideKeywords
  contribute to score without rendering; empty query returns all; hidden
  commands excluded.
- `leader.test.ts`: activating leader sets state; second key resets leader;
  2 s timeout reverts; escape cancels; nested chains not supported (flat only).

Run: `cd packages/devil-keybind && bun test`.

### Storybook (cross-renderer)

Each primitive ships two story variants, wired to a mock RenderTarget:

- `CommandPalette.Terminal` — renders under `@opentui/solid` in Storybook's
  terminal-mock harness (uses `@opentui/core` offscreen canvas).
- `CommandPalette.DOM` — renders as a native dialog.
- Same pattern for HelpOverlay, FooterBar, PasteModal.

Storybook harness already exists at `packages/devil-ui/.storybook/`. A new
decorator `withRenderTarget(kind)` wraps each story in the right provider.

### Playwright visual regression (DOM only)

`packages/devil-ui/tests/primitives-visual.spec.ts` snapshots the DOM variant
of each primitive. Terminal snapshots are deferred: they require a dedicated
capture pipeline (Phase 5 decision). Phase 3 ships text-golden assertions for
terminal layout in the unit tests instead.

## 9. Dependencies

New workspace package: `@devilcode/keybind` (added to root `package.json`
workspaces array).

New npm deps:

| Package | Version | Target | Rationale |
|---|---|---|---|
| `fuzzysort` | 3.1.0 (match opencode's pin) | `devil-keybind` dep | Fuzzy matching in palette |
| `zod` | catalog | `devil-keybind` dep | Schema validation |
| `@opentui/solid` | 0.1.87 (catalog-pin) | `devil-ui` **peer** dep | Terminal adapter; match opencode's version exactly to avoid renderer-singleton duplication |
| `@opentui/core` | 0.1.87 | `devil-ui` **peer** dep | Measurement utilities in terminal adapter |
| `@devilcode/keybind` | workspace:* | `devil-ui` dep, `opencode` dep | New workspace package |

All opentui versions pinned to the exact same version opencode already uses
(0.1.87). **Critical**: pin via the root catalog if not already there, so
future upgrades stay lockstep across packages.

## 10. Success Criteria

- [ ] `packages/devil-keybind/` exists with schemas, registry, matcher, leader modules; `bun test` passes from that directory.
- [ ] `packages/devil-ui/src/primitives/{command-palette,help-overlay,footer-bar,paste-modal}/index.tsx` exist and compile.
- [ ] `packages/devil-ui/src/adapters/{terminal,dom}.ts` exist; both implement the `RenderTargetAdapter` interface.
- [ ] `packages/devil-ui/src/context/render-target.tsx` exports `RenderTargetProvider` + `useRenderTarget`.
- [ ] `use-command-registry` and `use-prompt-history` hooks are exported from `devil-ui/hooks` barrel.
- [ ] Storybook builds (`bun run build-storybook` in devil-ui); 4 new story files render under both targets.
- [ ] Playwright visual regression passes for DOM variants (baseline snapshots committed).
- [ ] `bun turbo typecheck` green across the monorepo.
- [ ] `bun run knip` green in devil-vscode (no new stale exports; devil-ui additions exported via `exports` map).
- [ ] `bun run format:check` green in devil-vscode.
- [ ] `check-kilocode-change` green.
- [ ] `packages/opencode/src/devilcode/workflow-tui/index.tsx` boots without visual regression in the current TUI (eyeball test + existing workflow-tui integration tests still pass).
- [ ] No existing consumers of `useKeybind` or `useCommandDialog` broken.

## 11. Explicit Non-Goals

- **No replacement of any of the 8 `workflow-tui/*` files.** The only file
  in that directory touched in Phase 3 is `index.tsx` — and only to ADD a
  wrapping provider, not to restructure.
- **No team-builder UI.** Position picker, roster table, coverage indicator —
  all Phase 4.
- **No runtime cockpit redesign.** Stage→position mapping indicator, tab
  bar, onboarding — Phase 5.
- **No VS Code webview integration.** DOM adapter is built and storybook-tested,
  but no code in `packages/devil-vscode/` imports it in Phase 3. That consumption
  happens in Phase 9.
- **No migration of `useKeybind` consumers.** The old keybind context stays in
  place; the new registry layers on top and only new code calls it.
- **No user-facing keybind customization.** Configuration of keybinds via
  `TuiConfig.keybinds` continues to drive the existing util/keybind parser;
  devil-keybind reads the same string format but doesn't own the config surface.
- **No production command catalog.** Phase 3 registers only a handful of
  demo commands (for storybook) + the escape-to-back command already in
  workflow-tui. Real command wiring happens in Phases 4–5.

## 12. Risks Surfaced in Critique (unresolved — flag for plan phase)

1. **OpenTUI renderer singleton collision** — if devil-ui and opencode end up
   with two different `@opentui/solid` instances (e.g., Bun hoists duplicates),
   the terminal adapter's focus / measurement calls may reach the wrong
   renderer. Mitigation: declare as peer dep + verify in install step that
   `bun pm ls @opentui/solid` reports a single resolved version.
2. **Storybook terminal harness feasibility** — OpenTUI is designed for TTY;
   running it inside Storybook's browser sandbox may require an offscreen
   canvas stub. If blocked, fall back to text-golden unit tests for terminal
   layout and keep Storybook DOM-only. Decision deferred to plan phase after
   quick feasibility spike.
3. **Duplicate keybind parser** — devil-keybind re-implements the string
   parser that already lives in `packages/opencode/src/util/keybind.ts`.
   Phase 3 accepts this duplication to keep devil-keybind zero-dep on opencode.
   Follow-up: Phase 5 extracts the shared parser to `@opencode-ai/util` or
   into devil-keybind and flips opencode to consume from there.

## 13. Path Validation

- `packages/devil-keybind/*` — new Kilo package, no markers needed.
- `packages/devil-ui/src/{primitives,adapters,context,hooks,stories}/*` — inside entirely-Kilo package; no markers.
- `packages/opencode/src/devilcode/workflow-tui/index.tsx` — under `src/devilcode/`, markers exempt.
- `packages/opencode/package.json` + root `package.json` — **shared code**.
  The additions are workspace-manifest entries, not source code; per
  CLAUDE.md spirit we skip markers for manifest-only line changes but plan
  phase should confirm against `check-kilocode-change` behavior.
