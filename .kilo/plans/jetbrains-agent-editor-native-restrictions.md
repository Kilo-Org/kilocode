# Plan: JetBrains Agent Editor Native Restrictions

## Goal
Update the JetBrains agent settings editor so custom agents remain editable, while built-in/native agents are intentionally restricted. Skip permissions editing for this pass.

## Current Findings
- JetBrains currently opens the same `AgentEditDialog` for native and custom agents.
- `AgentEditDialog.kt` currently allows all agents to edit `mode`, `hidden`, `disable`, description, prompt, model, variant, temperature, top P, and steps.
- `AgentSettingsState.kt` already preserves `native` on `AgentEditDraft`, but the UI and patch logic do not use it for restrictions.
- Custom-agent delete UI is shown, but `AgentsConfigurable.onCell()` only handles edit, so delete is currently non-functional.
- The backend/RPC already provides `native` metadata in `AgentDetailDto`; no JetBrains API changes are needed for this editor change.
- Permissions are present in DTOs but intentionally out of scope for this plan.

## Editing Matrix
| Field / Action | Custom Agent | Native Agent |
|---|---|---|
| Agent ID / name | Read-only, display only | Read-only, display only |
| Native identity | Not editable | Not editable |
| Delete / remove | Allowed once delete is wired | Not allowed |
| Mode (`primary` / `subagent` / `all`) | Editable | Read-only/disabled |
| Disable agent | Editable | Read-only/disabled |
| Hide agent | Editable | Read-only/disabled |
| Description | Editable | Editable safe override |
| Prompt | Editable | Editable safe override |
| Model | Editable | Editable safe override |
| Variant | Editable | Editable safe override |
| Temperature | Editable | Editable safe override |
| Top P | Editable | Editable safe override |
| Steps | Editable | Editable safe override |
| Permissions | Skip in this pass | Skip in this pass |

## Implementation Steps
1. Add capability helpers in `AgentSettingsState.kt` or near the UI model:
   - `canDelete(agent)` returns `!agent.native`.
   - `canEditMode(agent)` returns `!agent.native`.
   - `canEditVisibility(agent)` returns `!agent.native` for `hidden` and `disable`.
   - Keep permissions helpers out of this pass, or add only if needed as a private placeholder with no UI usage.

2. Defensively enforce restrictions in the state/patch layer:
   - Update `updateAgent()` so native agents cannot clear the default agent by changing restricted fields from the UI.
   - Update `patchAgent()` so native-agent changes to `mode`, `hidden`, and `disable` are ignored even if a dialog/model bug tries to send them.
   - Keep safe override patching for native agents: `model`, `variant`, `prompt`, `description`, `temperature`, `top_p`, and `steps`.
   - Keep custom-agent behavior unchanged for all currently supported fields.

3. Update `AgentEditDialog.kt` UI behavior:
   - Leave the mode row visible for native agents, but disable the mode combo box and add explanatory text such as `Built-in agents cannot be changed to subagents.`
   - Leave visibility rows visible for native agents, but disable `Hidden` and `Disabled` toggles and add explanatory text such as `Built-in agents cannot be hidden or disabled.`
   - Keep name as display-only for every agent.
   - For `ask`, use ask-specific safety copy only in the explanation if useful, for example `Ask is a built-in read-only primary agent.` Do not use the name for the general restriction logic.
   - Do not add permissions UI in this pass.

4. Improve `SettingsToggle` only if needed:
   - Prefer setting `isEnabled = false` on the existing toggle instance in `AgentEditDialog`.
   - If this becomes repetitive, minimally extend `SettingsToggle` with an optional `enabled` parameter, but avoid broad changes to unrelated settings pages.

5. Update list behavior in `AgentsConfigurable.kt`:
   - Use `canDelete(agent)` for whether delete is present/enabled.
   - Wire `DELETE_CELL` for custom agents only if remove is considered currently supported by existing backend pieces.
   - Implementation path: confirmation dialog, call `KiloAgentBehaviorService.removeAgent(dir, name)`, update draft/base rows after success, and clear `defaultAgent` if the deleted custom agent was selected.
   - Native agents should not show delete, or should show it disabled only if a clear explanation can be surfaced; hiding is acceptable because the built-in badge already explains the distinction and the current list-cell model has no disabled reason text.

6. Add or update localized strings in `KiloBundle.properties`:
   - Native mode restriction text.
   - Native visibility restriction text.
   - Optional ask-specific read-only/safety note.
   - Delete confirmation title/message if wiring delete.
   - For non-English bundles, either add English fallback values consistently with existing project practice or update only the base bundle if localized fallback is accepted in this repo.

7. Update tests in `AgentSettingsStateTest.kt`:
   - Change tests that currently assume `code` can emit native-like `mode`, `hidden`, and `disable` changes.
   - Add a custom-agent test proving `mode`, `hidden`, and `disable` still patch normally when `native = false`.
   - Add a native-agent test proving `mode`, `hidden`, and `disable` changes are ignored in `patchAgent()` / `updateAgent()`.
   - Add a native-agent default-agent test proving restricted native changes do not remove the selected default agent.
   - Add a native draft merge test proving `native = true` is preserved from `AgentDetailDto`.

8. Optional UI tests, only if lightweight existing patterns support it:
   - Instantiate `AgentEditDialog` with a native draft and verify mode/hidden/disabled controls are disabled.
   - Instantiate with a custom draft and verify those controls are enabled.
   - If dialog tests are not already practical in this package, rely on state tests plus manual UI verification.

## Backend/API Assumptions
- JetBrains receives `native` for agents returned by `/app/agents`; this is already mapped into `AgentDetailDto.native`.
- This plan does not change CLI/server behavior. The CLI currently still honors manually edited config overrides like `agent.ask.mode` or `agent.ask.disable`; this UI fix prevents JetBrains from creating those invalid edits going forward.
- If full hardening against manually edited config is required, that should be a separate backend/CLI task because it affects all clients and may need shared opencode-file annotations.

## Verification
Run the smallest relevant JetBrains checks after implementation:
- From `packages/kilo-jetbrains/`: `./gradlew typecheck`.
- From `packages/kilo-jetbrains/`: targeted frontend tests covering agent settings state, or the package test task if targeted Gradle filtering is not straightforward.

## Expected Result
- Custom agents remain editable as before, including mode and visibility fields.
- Custom agents can be deleted if the existing remove RPC path is wired in this pass.
- Native agents remain visible and editable only for safe overrides.
- Native agents cannot be changed to subagents, hidden, disabled, or removed through the JetBrains UI.
- The ask agent stays a native primary read-only/safe built-in from the JetBrains editor perspective.
- Permissions editing remains unimplemented for now.
