# Settings List Mutation Refresh Plan

## Goal

Make JetBrains settings list mutations feel consistent and safe across agent behavior configurables:

- Show the standard settings progress overlay while a backend mutation is running or the CLI backend is reloading.
- Refresh the list only after the backend is ready again.
- Select the newly created row after add-agent when possible.
- Select a stable neighboring row after delete/removal.
- Reuse the behavior from the shared list base class instead of keeping add-agent-specific wait logic.

## Current Context

- `SettingsListPanel.reload()` already shows `loadingText()` via `SettingsProgressOverlay`, then calls `fetch()` and `view.update(items)`.
- Current add-agent code in `AgentsConfigurable.kt` has bespoke `waitForReload()` logic inside `CreateAction`.
- `SettingsListView.update(items)` preserves the current selected key, but has no public way to request a new preferred key or a previous index fallback.
- Agent delete currently updates local state optimistically after `removeAgent()` instead of waiting for the backend to reload and refetching.
- `SkillsSettingsUi` has both local draft removals and backend `removeSkill()` removals; only the backend removal should use the backend-ready mutation flow.
- `WorkflowsSettingsUi` has no mutations today, but should benefit from the base helper if mutations are added later.
- `McpSettingsUi` and `ProvidersSettingsUi` do not extend `SettingsListPanel`; do not migrate them in this change unless needed for compilation.

## Implementation Steps

1. Extend `SettingsListView` selection support.
   - Add a way for `update` to accept an optional preferred key and/or preferred index.
   - Keep existing behavior as the default: preserve the current selected key, then fall back to the first row.
   - Add an EDT-only accessor for the current selected index if the base panel needs to capture it before a delete.

2. Extend `SettingsListPanel` reload internals.
   - Change `reload()` to delegate to a private or protected reload implementation that accepts a selection target.
   - Update the existing `apply(id, items)` path to pass selection information into `view.update(...)`.
   - Keep manual refresh behavior unchanged apart from using the new shared implementation.

3. Add a reusable backend mutation helper to `SettingsListPanel`.
   - Provide a protected EDT entrypoint such as `mutateAndReload(...)` that:
     - Refuses to start when `busy` or disposed, using the existing `launch` gate.
     - Shows `loadingText()` or an optional progress message through the existing progress overlay.
     - Runs the supplied suspend mutation off EDT.
     - If the mutation returns false, clears progress and busy state without refetching.
     - Waits for a possible app reload by observing `KiloAppService.state`.
     - Fetches fresh rows in the same launched job.
     - Applies rows once on EDT with the requested selection target.
   - Move the add-agent `READY -> non-READY -> READY` wait logic into this helper.
   - Use the same timeouts as the existing add-agent fix unless tests show they need adjustment: short timeout to detect whether a reload starts, longer timeout to wait for readiness.
   - Avoid calling public `reload()` from inside the helper because `launch` already marks the panel busy and nested `reload()` would be ignored.

4. Model selection targets in the base class.
   - Support at least:
     - Preserve current selection, for ordinary refresh.
     - Prefer a specific key, for add-agent selecting the new agent.
     - Prefer the previous selected index, for delete/removal selecting a neighboring row.
   - Keep this internal to the settings base package if possible.

5. Update add-agent flow.
   - Remove `AgentsSettingsUi.CreateAction.waitForReload()` and its local app-state imports/constants.
   - Use the base `mutateAndReload` helper after `createAgent(dir, input)`.
   - Request selection by the created agent name.
   - Continue using the injectable `AgentCreateDialogHandle` seam from the existing tests.

6. Update delete-agent flow.
   - Keep the confirmation dialog unchanged.
   - Use the base `mutateAndReload` helper around `removeAgent(dir, agent.name)`.
   - Request selection by previous index.
   - Before the helper fetches fresh rows, ensure local agent draft/baseline state no longer contains the deleted agent so dirty draft merging in `fetch()` cannot resurrect it.
   - Do not optimistically call `view.update(rows())`; the visible list should change when the refreshed data is applied.

7. Update skills backend removal.
   - For discovered skills (`skill:` keys), use the base `mutateAndReload` helper around `removeSkill(dir, location)`.
   - Request selection by previous index.
   - Leave local `path:` and `url:` removals as immediate draft updates followed by local reload, since they do not perform backend mutations.

8. Keep workflows compatible.
   - No behavior change is required for `WorkflowsSettingsUi` because it is read-only today.
   - Confirm it still compiles with the updated base class.

9. Update user-visible strings only if needed.
   - Prefer reusing `settings.agentBehavior.loading=Loading items...` for the progress overlay.
   - Add a more specific message only if the implementation needs different text for mutation/reload waiting.

10. Update tests.
   - Add or extend `SettingsListViewTest` to cover preferred-key and preferred-index selection after `update`.
   - Update `AgentsSettingsUiTest` so add-agent asserts the `reviewer` row is selected after refresh.
   - Update the add-agent backend-reload regression to assert the standard progress overlay remains visible while the app is `LOADING` and the row appears only after `READY`.
   - Update delete-agent coverage to assert removal waits for backend readiness/refetch and selects a neighboring row.
   - Add fake RPC support for delete-after hooks if needed, mirroring the existing `afterCreate` hook.
   - Add skill-removal coverage if there is already a practical `SkillsSettingsUi` test fixture; otherwise keep it focused on the shared helper and agent flows.

11. Validate.
   - Run focused tests from `packages/kilo-jetbrains/`:
     - `./gradlew :frontend:test --tests "ai.kilocode.client.settings.base.SettingsListViewTest" --tests "ai.kilocode.client.settings.agents.AgentCreateDialogTest" --tests "ai.kilocode.client.settings.agents.AgentsSettingsUiTest"`
   - Include any new skills settings test class in the same command if added.
   - Run `./gradlew typecheck` from `packages/kilo-jetbrains/`.

## Risks And Safeguards

- Dirty agent drafts can reintroduce a deleted agent during refetch. Safeguard by pruning deleted agents from local draft/baseline state before refetch applies.
- A generic helper can accidentally delay local-only changes. Safeguard by using it only for backend mutations, not for pure draft edits.
- Nested reload calls will be ignored while `busy` is true. Safeguard by fetching and applying inside the mutation helper's own launched job.
- If the app leaves `READY` and never returns, the helper should not silently hang forever. Use the existing timeout pattern and surface the failure through the existing `launch` error/progress handling.
- All Swing reads/writes must remain on EDT. Capture selection and update the view only on EDT; run RPC and waiting off EDT.

## Out Of Scope

- Migrating `ProvidersSettingsUi` or `McpSettingsUi` to `SettingsListPanel`.
- Changing backend RPC contracts.
- Rebuilding or regenerating CLI/SDK artifacts.
