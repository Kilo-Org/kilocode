# Phase 3 Context — TUI Scaffolding: Hybrid Interaction Primitives

## Phase Goal

Ship the reusable interaction primitives that power every later TUI view and the future VS Code webview: command palette (Ctrl+K), help overlay (`?`), context-aware footer action bar, paste-mode modal, central keybinding registry with Ctrl+X leader key, prompt history (Up/Down), keyboard-navigable tabs (Tab/Shift+Tab).

**Phase 3 is scaffolding only.** No workflow-tui file replacement (Phase 5). No team-builder views (Phase 4). No VS Code webview consumption (Phase 9).

## Requirements (from ROADMAP.md)

- Hybrid interaction model — Ctrl+K palette, `?` overlay, footer action bar, paste modal, Ctrl+X leader, prompt history, tab navigation
- Reusable from both TUI (OpenTUI/SolidJS) and (Phase 9) VS Code webview via shared devil-ui components
- Storybook entries for each primitive; unit tests for fuzzy match + keybind routing
- OpenTUI primitive research: confirm modal/palette absent; build custom in devil-ui

## Selected Architecture — Clean

User selected the Clean philosophy over Minimal / Pragmatic after reviewing three parallel architecture proposals.

- **NEW package** `packages/devil-keybind/` — platform-agnostic, SolidJS-free, Zod-typed Command + Keybind schemas. Pure logic: registry, matcher (fuzzysort), scoping (`global` / `workflow` / `team-builder` / `review`), Ctrl+X leader chain with 2s timeout.
- **`packages/devil-ui/` additions** — new `primitives/` directory + `context/render-target.tsx` provider + `adapters/{terminal,dom}.ts` + `hooks/use-command-registry.ts` + `hooks/use-prompt-history.ts`.
- **RenderTarget abstraction** — `<Surface kind={adapter.kind}>` helper picks `<box>` (terminal) vs `<div>` (DOM) at smallest boundary; primitives are shared SolidJS.
- **Peer-dep** `@opentui/solid` + `@opentui/core` in devil-ui to avoid renderer-singleton duplication with opencode.
- **Phase 9 target**: webview imports devil-ui + devil-keybind as-is; zero visual rebuild.

**Cost**: ~1,660 LOC across Phase 3. **Payoff**: Phase 9 zero duplication + testable logic + cross-renderer Storybook.

## Existing Assets (from Phase 1 + 2)

- `packages/opencode/src/devilcode/team/library.ts` — 11 canonical positions.
- `packages/opencode/src/devilcode/team/capabilities.ts` — capability enum + `STAGE_CAPABILITY_REQUIREMENTS`.
- `packages/opencode/src/devilcode/team/config.ts` — `CanonicalTeamConfig`, `CanonicalTeamRole` Zod schemas.
- `packages/opencode/src/devilcode/team/migration.ts` — `migrateLegacyTeamConfig`.
- 5 quickstart JSON templates at `packages/opencode/src/devilcode/team/quickstarts/*.json`.
- `/team init` reworked to launch TUI team-builder w/ quickstart options (read-then-merge `Config.update` pattern).
- `packages/devil-ui/` — SolidJS component library w/ existing Storybook harness at `.storybook/`.
- `packages/opencode/src/devilcode/workflow-tui/` — 8 files, ~600 LOC, current TUI (to be replaced Phase 5, only `index.tsx` touched in Phase 3 to add provider wrap).
- `packages/opencode/src/util/keybind.ts` — existing keybind parser (devil-keybind duplicates string format; Phase 5 consolidates).
- `packages/opencode/src/cli/cmd/tui/context/keybind.tsx` — existing `useKeybind` context (coexists, not replaced).
- `fuzzysort@3.1.0` — already in opencode deps; devil-keybind pins same version.
- `@opentui/solid@0.1.87` + `@opentui/core@0.1.87` — pinned in opencode; devil-ui declares as peer.

## Key Decisions (recorded here for plan reference)

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Clean architecture over Minimal / Pragmatic | User prioritized Phase 9 zero-rework; willing to pay ~1,660 LOC now | New `devil-keybind` pkg + `devil-ui` primitives w/ RenderTarget adapter |
| Peer-dep `@opentui/solid` in devil-ui | Prevent renderer-singleton duplication | Catalog-pin 0.1.87; verify w/ `bun pm ls @opentui/solid` |
| Duplicate keybind parser in devil-keybind | Zero-dep on opencode | Phase 5 follow-up extracts shared parser |
| `<Surface>` helper, not full JSX abstraction | Keep render-target switch at smallest boundary | Each primitive branches once at root element |
| Terminal Storybook = feasibility spike | OpenTUI-in-browser unknown | Plan 03-03 Task 1 spike; fallback = DOM-only stories + text-golden unit tests for terminal |
| Workflow-tui `index.tsx` only edit | Coexist w/ existing `useKeybind` / `useCommandDialog` | Wrap `WorkflowViewInner` in `RenderTargetProvider` + `WorkflowCommandRegistryProvider`; no restructure |
| No `devilcode_change` markers | `devil-keybind` + `devil-ui` are entirely Kilo; workflow-tui is under `src/devilcode/` | Markers exempt per CLAUDE.md |
| Architecture proposals: 3 generated (Minimal, Clean, Pragmatic) | Complexity justified parallel exploration | Saved in agent transcripts; Clean selected |
| Spec pipeline run before decomposition | User opted in | `.planning/specs/03-tui-scaffolding-spec.md` produced; 32 deliverables enumerated |

## Plan Structure

**Wave 1 → Wave 2 → Wave 3 (strict linear; each wave blocks the next)**

| Plan | Wave | Title | Deliverables | LOC | Primary | Reviewer |
|------|------|-------|--------------|-----|---------|----------|
| 03-01 | 1 | devil-keybind Package Foundation | D1–D10, D32 | ~755 | Backend Architect + Senior Developer | QA Verification Specialist |
| 03-02 | 2 | devil-ui RenderTarget + Adapters + Hooks | D11–D16, D27–D29, D31 | ~485 | Frontend Developer + Senior Developer | Backend Architect |
| 03-03 | 3 | Primitives + Storybook + Integration | D17–D26, D30 | ~455 | Frontend Developer + UI Designer | QA Verification Specialist |

Deliverable IDs reference `.planning/specs/03-tui-scaffolding-spec.md` §3.

## Critical Risks (surfaced in spec critique; flagged here, not blocking)

1. **OpenTUI renderer singleton collision** — Mitigated via catalog-pin + `bun pm ls` check in Plan 03-02 install step.
2. **Storybook terminal harness feasibility unknown** — Plan 03-03 Task 1 starts w/ quick feasibility spike. Fallback: DOM-only Storybook + text-golden unit tests for terminal layout.
3. **Duplicate keybind parser (devil-keybind vs `src/util/keybind.ts`)** — Accepted debt; Phase 5 extracts shared parser.

## References

- Spec: `.planning/specs/03-tui-scaffolding-spec.md`
- Phase 1 spec: `.planning/specs/01-foundation-spec.md`
- CODEBASE: `.planning/CODEBASE.md` (analyzed 2026-04-18)
- Prior design doc: `docs/superpowers/specs/2026-04-06-workflow-tui-design.md` (read + reconciled in Phase 1)

---
*Planned: 2026-04-19*
