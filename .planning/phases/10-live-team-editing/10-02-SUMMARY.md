# Plan 10-02 Summary

## Status
Complete

## Files Modified
- `packages/opencode/src/devilcode/workflow-tui/commands/team-swap.ts`: New file — `swapCommand()` handler and `registerTeamSwapCommand()` registry binding, following team-io.ts/team-registry.ts DI pattern. Handler calls `applyPositionSwap()` directly (no HTTP in TUI layer); `onSwapped` callback receives the updated `CanonicalTeamConfig` and persists via `Config.update()`.
- `packages/opencode/src/devilcode/workflow-tui/command-input.tsx`: Added import for `swapCommand`/`TeamSwapCommandHandlers`; added `swapHandlers()` factory function; added `team swap <position> <provider> <model>` branch in `handleCommand()` after team-registry block with `// devilcode_change` marker.
- `packages/devil-vscode/src/messages/team-builder-types.ts`: Added `TeamBuilderSwapIn` (webview→extension) and `TeamBuilderSwappedOut` (extension→webview) interfaces; added both to their respective union types.
- `packages/devil-vscode/src/services/cli-backend/connection-service.ts`: Added `swapPosition(position, provider, model)` async method inside existing `// devilcode_change` block, using the existing `teamFetch()` helper to POST to `/devilcode/workflow/team/swap`.
- `packages/devil-vscode/src/agent-manager/team-builder-handler.ts`: Added import for `TeamBuilderSwapIn`; added `case "teamBuilder.swapPosition":` in switch; added `private async handleSwapPosition(msg)` method with try/catch posting back `teamBuilder.swapped`.
- `packages/devil-docs/pages/collaborate/teams/team-orchestrator-guide.md`: New file — complete user guide covering 7-stage workflow, TUI commands, live team editing (phase 10 feature), monitoring, and troubleshooting.
- `packages/devil-docs/pages/collaborate/teams/workflow-tui-migration.md`: New file — migration guide covering config format changes, file location changes, command changes, preset mapping, breaking changes, migration steps, and FAQ.
- `packages/devil-docs/pages/collaborate/index.md`: Added links to both new docs under the Team Management section.

## Verification
| Command | Result | Pass? |
|---------|--------|-------|
| `cd packages/opencode && bun run typecheck` (errors in new files) | No errors in team-swap.ts or command-input.tsx | Yes |
| `cd packages/devil-vscode && bun run typecheck` | Clean — no errors | Yes |
| `cd packages/devil-vscode && bun run knip` | Clean — no unused exports | Yes |
| `cd packages/devil-vscode && bun run format` | All files unchanged (already formatted) | Yes |
| `cd packages/devil-vscode && bun run format:check` | "All matched files use Prettier code style!" | Yes |
| `cd packages/opencode && bun test test/devilcode/team/position-swap.test.ts` | 9 pass, 0 fail | Yes |
| `cd packages/opencode && bun test test/devilcode/workflow/live-swap.test.ts` | 13 pass, 0 fail | Yes |
| `bun turbo typecheck` | Failed: `@devilcode/kilo-ui#typecheck` (pre-existing) | Pre-existing |

## Decisions

1. **TUI uses direct function call, not HTTP fetch**: The TUI command module calls `applyPositionSwap()` directly (same pattern as team-io.ts which calls `exportTeamToFile`/`importTeamFromFile` directly). The HTTP endpoint `/devilcode/workflow/team/swap` is used by the VS Code extension only. This is correct — the TUI runs in the same Bun process as the CLI.

2. **`onSwapped` receives `CanonicalTeamConfig` not `PositionSwapResult`**: Modeled after `onImported` in `TeamIOCommandHandlers`, which receives the full config for persistence. The swap command applies the change to a clone, then passes the updated config to `onSwapped` for `Config.update()`. This is cleaner than passing the result and re-deriving the config in the handler.

3. **`TeamBuilderSwapIn` import added explicitly**: The handler cast `msg as TeamBuilderInMessage` but the new `swapPosition` case needs typed access to `msg.position/provider/model`. Added a typed local parameter `msg: TeamBuilderSwapIn` to `handleSwapPosition` and imported the interface directly to avoid any type assertions in the method body.

4. **`// devilcode_change` marker applied only to the new `team swap` block in command-input.tsx**: The new import line is contiguous with existing Phase 8 imports and does not need an individual marker. The swap branch block gets its own single-line marker per convention.

## Issues Found

**Pre-existing**: `bun turbo typecheck` fails on `@devilcode/kilo-ui#typecheck` with module resolution errors in `opencode/src/tool/task.ts` and `opencode/src/worktree/index.ts` (`Cannot find module '@/util/defer'`, `@/permission/next'`, `@/bus/bus-event'`, etc.). These errors exist on `main` before any Plan 10-02 changes — confirmed by stashing all changes and running turbo typecheck, which produces the same failure. The opencode package's own `bun run typecheck` (which uses tsgo with the correct path aliases) passes clean.

**Pre-existing**: `packages/opencode/src/devilcode/workflow-tui/command-input.tsx` does not import `swapCommand` at build — this is intentional; the import was added in this plan. No circular dependency issues.

**Pre-existing**: `test/devilcode/team/layered-repository.test.ts` fails typecheck under devil-ui's tsconfig due to missing `isQuickstart` field in test fixtures. Not introduced by Plan 10-02.

## Phase 10 Completion

Phase 10 delivered full live team editing infrastructure:

**Plan 10-01 (prior)**:
- `PositionSwapRequest/Result/Success/Failure` Zod schemas in `position-swap.ts`
- `validatePositionSwap()` + `applyPositionSwap()` functions
- `position-swap-events.ts` with 4 bus events
- `POST /devilcode/workflow/team/swap` HTTP endpoint with concurrency rebalancing and Config.update() persistence
- `ConcurrencyManager.rebalanceAfterSwap()` method
- 22 tests (9 unit + 13 chaos)

**Plan 10-02 (this plan)**:
- `team-swap.ts` TUI command module with DI handler pattern
- `team swap <position> <provider> <model>` command wired in `command-input.tsx`
- `TeamBuilderSwapIn` / `TeamBuilderSwappedOut` VS Code message types
- `DevilConnectionService.swapPosition()` method calling the HTTP endpoint
- `TeamBuilderHandler.handleSwapPosition()` bridging webview messages to the CLI backend
- User guide (`team-orchestrator-guide.md`) covering the full 7-stage workflow + live swap feature
- Migration guide (`workflow-tui-migration.md`) for users upgrading from legacy workflow TUI
- Documentation index updated with links to both new guides
