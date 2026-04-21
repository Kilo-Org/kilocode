# Plan 03-03 Summary — Primitives + Storybook + Integration

**Status**: Complete
**Wave**: 3
**Agent**: engineering-frontend-developer
**Date**: 2026-04-19

## Files Created

- `packages/devil-ui/src/primitives/command-palette/index.tsx` — `CommandPalette` w/ full DOM branch + Phase 3 terminal stub
- `packages/devil-ui/src/primitives/help-overlay/index.tsx` — `HelpOverlay` grouped by scope; DOM branch; terminal stub
- `packages/devil-ui/src/primitives/footer-bar/index.tsx` — `FooterBar` hint tiles DOM branch; terminal stub
- `packages/devil-ui/src/primitives/paste-modal/index.tsx` — `PasteModal` native `<dialog>` DOM branch (Ctrl+Enter submit, Esc cancel); Phase 3 terminal stub w/ single-line `<input>` (full multiline in Phase 5)
- `packages/devil-ui/src/primitives/TERMINAL-STORYBOOK-DECISION.md` — Spike outcome: INFEASIBLE (expected); documents DOM-only strategy
- `packages/devil-ui/src/stories/command-palette.stories.tsx` — 5 DOM stories
- `packages/devil-ui/src/stories/help-overlay.stories.tsx` — DOM stories
- `packages/devil-ui/src/stories/footer-bar.stories.tsx` — DOM stories (Default, CompactView, GlobalScopeOnly, EmptyRegistry)
- `packages/devil-ui/src/stories/paste-modal.stories.tsx` — DOM stories (Open, Closed)
- `packages/opencode/test/devilcode/workflow-tui/index.smoke.test.ts` — 7 structural smoke tests (readFileSync-based; @opentui/solid JSX runtime not importable in Bun test env)

## Files Modified

- `packages/devil-ui/src/primitives/index.ts` — Populated barrel with 4 primitives
- `packages/opencode/src/devilcode/workflow-tui/index.tsx` — Added `createResource`-based terminal adapter + `RenderTargetProvider` + `CommandRegistryProvider` wrapping `WorkflowViewInner`; `WorkflowProvider` remains outermost; `WorkflowViewInner` takes no props; existing `command.register()` preserved
- `.planning/STATE.md` — Wave 3 results appended + Next Action updated

## Post-Agent Fix

`HelpOverlay.groups` and `FooterBar.hints` memos originally filtered `registry.entries()` (global-scope only signal) by scope — scope-specific commands would never appear. Fixed:
- Read `registry.entries()` as reactive trigger only (fires on any registry mutation)
- Call `registry.search("", props.scope)` for actual data (`getAllByScope(scope)` = global + scope-specific)

## Verification

| Command | Result |
|---------|--------|
| `bun turbo typecheck` (14/14) | PASS |
| `cd packages/devil-ui && bun run typecheck` (tsgo direct) | PASS |
| `cd packages/devil-keybind && bun test` (46 pass) | PASS |
| `cd packages/devil-ui && bun test src/hooks/__tests__` (14 pass) | PASS |
| `cd packages/opencode && bun test test/devilcode/workflow-tui` (7 pass) | PASS |
| `cd packages/devil-vscode && bun run knip` | PASS |
| `cd packages/devil-vscode && bun run format:check` | PASS |
| `cd packages/devil-vscode && bun run check-devilcode-change` | PASS |

**Verification Commands Run**: 8
**Verification Passed**: 8
**Verification Failed**: 0

## Key Decisions

1. `createResource` over top-level `await` in `workflow-tui/index.tsx` — idiomatic SolidJS; `<Show when={terminalAdapter()}>` gates render until adapter resolves. Avoids Bun startup ambiguity.
2. Structural smoke tests via `readFileSync` — `@opentui/solid` doesn't export `jsxDEV`, so direct import fails in Bun test env. Same rationale as pre-existing `test/kilocode/help.test.ts` comment.
3. Playwright spec not created — pre-existing `tests/visual-regression.spec.ts` auto-discovers all Storybook stories; new primitive stories covered automatically.
4. Terminal Storybook spike: INFEASIBLE as expected — `@opentui/solid` targets TTY; Vite browser conditions don't satisfy its peer deps.
5. Post-agent scope-filter bug fix: `HelpOverlay`/`FooterBar` use `registry.entries()` as reactive trigger + `registry.search("", scope)` for actual data.

## Issues

Post-agent scope-filter bug (fixed): `entries` signal tracks "global" scope only; HelpOverlay/FooterBar need global + scope-specific commands. Fixed before commit.

## Requirements Covered

- Hybrid interaction model — CommandPalette + HelpOverlay + FooterBar + PasteModal primitives complete
- RenderTarget abstraction exercised by all 4 primitives (terminal stub + DOM branch)
- workflow-tui integrated with provider tree
