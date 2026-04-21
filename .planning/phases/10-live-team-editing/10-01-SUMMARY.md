# Plan 10-01 Summary

## Status
Complete with Warnings

## Files Modified
- `packages/opencode/src/devilcode/team/position-swap.ts`: NEW — PositionSwapRequest, PositionSwapResult, PositionSwapErrorCode, PositionSwapSuccess, PositionSwapFailure schemas; validatePositionSwap and applyPositionSwap functions
- `packages/opencode/src/devilcode/workflow/position-swap-events.ts`: NEW — 4 BusEvent definitions: PositionSwapValidating, PositionSwapSucceeded, PositionSwapFailed, PositionSwapRebalanced
- `packages/opencode/src/devilcode/team/concurrency.ts`: Added `rebalanceAfterSwap(role, oldMax, newMax)` method to ConcurrencyManager class
- `packages/opencode/src/devilcode/workflow/routes.ts`: Added `POST /team/swap` route with full Bus event emission, Config.get/update persistence, and concurrency rebalancing
- `packages/opencode/src/devilcode/team/index.ts`: Exported position-swap symbols (Phase 10 block)
- `packages/opencode/src/devilcode/workflow/index.ts`: Exported position-swap-events symbols (Phase 10 block)
- `packages/opencode/test/devilcode/team/position-swap.test.ts`: NEW — 9 unit tests covering validatePositionSwap and applyPositionSwap
- `packages/opencode/test/devilcode/workflow/live-swap.test.ts`: NEW — 13 chaos tests covering swap mid-wave, during review, rapid consecutive swaps, invalid swaps, and concurrency rebalancing

## Verification
| Command | Result | Pass? |
|---------|--------|-------|
| `cd packages/opencode && bun run typecheck` (position-swap.ts errors) | 0 errors in new files | Yes |
| `cd packages/opencode && bun run typecheck` (position-swap-events.ts errors) | 0 errors in new files | Yes |
| `cd packages/opencode && bun run typecheck` (routes.ts errors) | 0 errors in new files | Yes |
| `cd packages/opencode && bun test test/devilcode/team/position-swap.test.ts` | 9 pass, 0 fail | Yes |
| `cd packages/opencode && bun test test/devilcode/workflow/live-swap.test.ts` | 13 pass, 0 fail | Yes |
| `bun turbo typecheck` | 8/9 packages pass; @devilcode/kilo-ui fails on pre-existing errors | Warning |

## Decisions
1. **BusEvent import**: Used `@/bus/bus-event` (not `@/bus`) for `BusEvent.define` — matches the actual pattern used across the codebase (command/index.ts, worktree/index.ts, lsp/client.ts). The `@/bus` barrel only exports the `Bus` namespace, not `BusEvent`.
2. **workflow/index.ts barrel**: The plan said to add `export * from "./position-swap-events"` to workflow/index.ts. However, workflow/index.ts is the Workflow namespace module (not a pure barrel). Added a named export block at the bottom of the file rather than using `export *` to avoid shadowing the Workflow namespace export.
3. **applyPositionSwap mutates config**: The function mutates the role in-place on the passed-in config object (as specified). In the HTTP route, the config is deep-cloned with `JSON.parse(JSON.stringify(...))` before passing to applyPositionSwap to avoid mutating the cached state.
4. **rebalanceAfterSwap semantics**: Since position swap currently only changes provider/model (not maxConcurrent), the concurrency call in routes.ts correctly passes `oldMax === newMax` (resulting in no-op). When future plans wire up maxConcurrent changes, the method is ready.
5. **Config.update type**: `Config.update` takes `Config.Info` (the full config output type). The route spreads `{ ...current, team: teamConfig }` which satisfies this type correctly.

## Issues Found
**Pre-existing issues (not introduced by this plan):**
1. `packages/devil-ui` typecheck fails with 20+ pre-existing errors — TS2307 "Cannot find module '@/bus/bus-event'" and similar `@/` alias resolution failures. The same pattern exists in `packages/opencode/src/worktree/index.ts` (pre-dates Phase 10). Root cause: devil-ui's tsconfig does not resolve the `@/` path alias defined in opencode's tsconfig.
2. `test/devilcode/team/layered-repository.test.ts` has 2 pre-existing TS2322/TS2741 errors about missing `isQuickstart` property on TeamHandle fixtures — these exist before any Phase 10 changes.
3. `packages/devil-ui` has 3 pre-existing SpanProps type errors in primitives/detail-panel, stage-position-badge, and tab-group components.

## Handoff to Plan 10-02
- **position-swap.ts** exports `validatePositionSwap`, `applyPositionSwap`, and all Zod schemas — ready for Plan 10-02 to consume or extend
- **POST /devilcode/workflow/team/swap** is live at `/devilcode/workflow/team/swap` — Plan 10-02 can add VS Code extension integration against this endpoint
- **PositionSwapSucceeded / PositionSwapFailed** bus events are defined — Plan 10-02 can subscribe via `Bus.subscribe(PositionSwapSucceeded, ...)` for SSE push to webview
- **ConcurrencyManager.rebalanceAfterSwap** is ready — if Plan 10-02 adds maxConcurrent changes to the swap request, the concurrency side is already wired up
- The `applyPositionSwap` function mutates a clone (routes.ts clones before calling) — Plan 10-02 should follow the same pattern if calling applyPositionSwap outside of routes
