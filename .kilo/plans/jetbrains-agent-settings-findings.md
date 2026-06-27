# JetBrains Agent Settings — Analysis Findings

Analysis of the **Agents** settings page in `packages/kilo-jetbrains/` across four dimensions:
test coverage, parity with the VS Code extension, memory/performance leaks, and conformance
to the JetBrains `AGENTS.md`. The feature is fully committed (`da064ee0`…`4295d11d`).

Scope of files reviewed:

- `frontend/.../settings/agents/` — `AgentsConfigurable.kt`, `AgentSettingsState.kt`,
  `AgentCreateState.kt`, `AgentCreateDialog.kt`, `AgentEditDialog.kt`,
  `AgentBehaviorConfigurable.kt`, `AgentBehaviorConfigurableBase.kt`, `Mcp/Rules/Workflows/Skills`
- `frontend/.../app/KiloAgentBehaviorService.kt`
- `frontend/.../settings/base/` — `SettingsListPanel.kt`, `SettingsListView.kt`,
  `KiloReadyConfigurable.kt`, `SettingsRow.kt`, `SettingsToggle.kt`
- `backend/.../rpc/KiloAgentBehaviorRpcApiImpl.kt`
- `shared/.../rpc/KiloAgentBehaviorRpcApi.kt`, `shared/.../rpc/dto/AgentBehaviorDto.kt`
- VS Code parity: `webview-ui/src/components/settings/AgentBehaviourTab.tsx`,
  `ModeCreateView.tsx`, `ModeEditView.tsx`
- CLI contract: `packages/opencode/src/kilocode/agent/builder.ts`

---

## 1. Test coverage

Present and solid:

| Test | Covers |
|---|---|
| `AgentSettingsStateTest` | `agentsDraft`, `updateAgent`, `patch` (changed-field/clear/native-restriction), `savedMatches`, default-agent clearing |
| `AgentCreateStateTest` | `validateAgentCreate` — blank/invalid/duplicate name, blank prompt, invalid mode, all valid modes |
| `KiloAgentBehaviorServiceTest` | `createAgent`/`removeAgent` round trips + `safe()` failure fallback, off-EDT assertions |
| `AgentsSettingsUiTest` | Real `BasePlatformTestCase` + real Swing + fake RPC: CLI→UI load, default-agent patch UI→CLI, reset, add+reload render, synthetic-click delete |

`AgentsSettingsUiTest` conforms to the AGENTS.md "do not mock the EDT" rule (real EDT, fake RPC,
`flushUntil` drains coroutines + EDT).

Gaps (significant):

- **`AgentCreateDialogTest.kt` and `AgentEditDialogTest.kt` are missing**, though the e2e-tests
  plan required them (`jetbrains-agent-settings-e2e-tests.md` lines 116–131, 191). The plan's
  correctness argument for edit→CLI is "dialog form binding + existing state transforms"; only the
  transforms half exists. Untested form-binding logic:
  - `AgentCreateDialog.result()` incl. scope label→value mapping (`AgentCreateDialog.kt:61-64`),
    which silently breaks if the i18n label changes.
  - `AgentEditDialog.result()` — blank→null trimming, numeric parse, mode read-back, native
    restriction (description non-editable, mode/visibility toggles disabled).
  - `NumericFilter` decimal/integer document filter (`AgentEditDialog.kt:242-260`).
- **Modal action wiring is never exercised end-to-end.** `CreateAction.actionPerformed` →
  dialog → `createAgent` → `reload` (`AgentsConfigurable.kt:235-244`) and `onCell(EDIT_CELL)` →
  `AgentEditDialog.showAndGet()` → `updateAgent` (`AgentsConfigurable.kt:99-112`) are not driven
  (headless-modal limitation). Adding the two dialog tests mostly closes this.
- Optional "failed config update keeps change pending" case not implemented.

## 2. Parity with VS Code (`AgentBehaviourTab`)

Structurally equivalent: VS Code's 5 subtabs ↔ 5 JetBrains Configurables.

At/above parity for the agents page:
- Default-agent picker with the same eligibility filter (`defaultAgentCandidate`).
- All five badges (`custom`, `subagent`, `hidden`, `disabled`, `deprecated`).
- Delete restricted to custom (non-native).
- Edit dialog covers description/prompt/model/variant/temperature/topP/steps/hidden/disable —
  equal to `ModeEditView` **plus** a `mode` selector VS Code's edit lacks.
- Create dialog **adds mode + scope (project/global)** that `ModeCreateView` lacks.

Parity gaps (deferred — to be added later by the user):
- **Import agent is a no-op** (`PlaceholderAction`, `AgentsConfigurable.kt:229,267-271`); VS Code has
  working `.json` import.
- **No Export agent**; VS Code's `ModeEditView` has Export.
- **Create persistence differs**: VS Code writes to config `agent` map (mode hardcoded primary);
  JetBrains writes a markdown agent file via agent-builder `save` (`KiloAgentBehaviorRpcApiImpl.kt:74-86`).
- No "Browse Marketplace" on the JetBrains agents page (minor).

Validation parity confirmed: JetBrains regex `^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$` is equivalent to the
CLI's `min(1).max(64).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)` (`builder.ts:13-17`); prompt non-blank
matches `z.string().regex(/\S/)`.

## 3. Memory & performance / leaks

- **Panel `dispose()` never called in production for agent-behavior pages.** `AgentsSettingsUi`
  extends `SettingsListPanel` (a `Disposable` that registers shortcut sets with itself as parent,
  `SettingsListPanel.kt:139-141`), but `AgentBehaviorConfigurableBase.disposeReadyComponent` only
  nulls the field (`AgentBehaviorConfigurableBase.kt:28-30`). Sibling configurables
  (`ProvidersConfigurable:36-40`, `ModelsConfigurable`, `UserProfileConfigurable`) call
  `panel.dispose()`. The coroutine is still cleaned up via scope cancellation
  (`KiloReadyConfigurable.kt:74-89`), so this is a *bounded* leak (Disposer node + shortcut
  registrations per page open), but an inconsistency. Applies to Agents/Workflows/Skills
  (`SettingsListPanel`); Mcp/Rules are `BaseContentPanel` (not `Disposable`).
- **Blocking HTTP on the Default dispatcher.** The raw okhttp path wraps work in
  `withContext(Dispatchers.IO)` (`request()`, `:132`), but typed generated-client calls do not —
  `createAgent` → `api.agentBuilderSave(...)` (`:84`) and `agents` → `api.appAgents(...)` (`:47`)
  run on the caller's `Dispatchers.Default` context. Violates the JetBrains threading guide.
- `EditorTextField` prompt fields are managed by the platform (released on `removeNotify`, dialog
  disposes its tree) — no leak, but the missing dialog tests should baseline editor counts.
- Settings list is small-N and not a streaming surface, so the retained-component stress/leak test
  requirement does not apply.

## 4. Conformance to AGENTS.md

Strong overall: RPC contract files changed together, all `@Serializable`, Kilo-owned (no
`kilocode_change` markers); `@Rpc`/`RemoteApi<Unit>`/`suspend`; RPC off-EDT; `durable {}`; EDT
discipline (`@RequiresEdt`, EDT dispatcher hops, `ActionUpdateThread.EDT`); standard Swing + IntelliJ
components, `JBUI`/`UiStyle`, theme-derived styling, `DialogWrapper` validation, complete i18n; no
UI DSL / Compose / JCEF.

Minor deviations: the dispose inconsistency and `Dispatchers.IO` omission (above); `remove()` uses
`Messages.showYesNoDialog` (`AgentsConfigurable.kt:177`) where AGENTS.md prefers non-modal (a
confirm-destroy dialog is a reasonable exception, matches VS Code).

---

## Action plan

1. **Add the two missing dialog tests** (`AgentCreateDialogTest`, `AgentEditDialogTest`) — largest gap.
2. **Honor the `Disposable` contract** — `AgentBehaviorConfigurableBase.disposeReadyComponent` should
   dispose the panel when it is `Disposable`.
3. **Wrap typed generated-client calls** (`createAgent`, `agents`) in `withContext(Dispatchers.IO)`.
4. *(deferred)* Implement Import (and Export) to close VS Code parity; reconcile create-persistence.

## Work completed (items 1–3)

- **Item 1 — dialog tests added** (both pass):
  - `AgentCreateDialogTest.kt` — default empty/primary/project form, full read-back into
    `AgentCreateDto`, trim + blank-description-dropped.
  - `AgentEditDialogTest.kt` — loads a populated draft into the form, reads edits back
    (description/prompt/temperature/topP/steps/mode/hidden/disable), and native-restriction
    (description non-editable, mode/visibility toggles disabled, restricted fields unchanged).
  - **Note (test seam):** `BasePlatformTestCase` is headless, so `HeadlessDialog.getRootPane()`
    returns `null` and the planned `dialog.rootPane` traversal is impossible. The dialogs keep their
    inputs as private fields laid out by `createCenterPanel()`. To let tests inspect the *real*
    component tree (and the real `result()`), each dialog now caches its center panel and exposes it
    via `internal fun contentForTest(): JComponent` — consistent with the existing
    `ModelPicker.selectedForTest()`/`selectionKeyForTest()` precedent. If you prefer no test seam,
    the alternative is extracting an `internal AgentCreateForm`/`AgentEditForm` component.
- **Item 2 — dispose fixed**: `AgentBehaviorConfigurableBase.disposeReadyComponent` now calls
  `(panel as? Disposable)?.dispose()` (guarded; Mcp/Rules panels are `BaseContentPanel`, not
  `Disposable`). `AgentsSettingsUiTest` still passes.
- **Item 3 — Dispatchers.IO**: `KiloAgentBehaviorRpcApiImpl.agents()` and `createAgent()` now wrap the
  typed generated-client calls (`appAgents`, `agentBuilderSave`) in `withContext(Dispatchers.IO)`.

Validation: `./gradlew typecheck` passes; targeted frontend tests pass —
`AgentCreateDialogTest` (3), `AgentEditDialogTest` (3), `AgentsSettingsUiTest` (5),
`AgentCreateStateTest` (7), `KiloAgentBehaviorServiceTest` (4).

Item 4 (Import/Export parity, create-persistence reconciliation) deferred to the user.

## Follow-up noted while writing tests (not addressed)

- `AgentEditDialog.variant` uses a numeric-only `NumericField` (`AgentEditDialog.kt:65`), but a model
  `variant` is a string (e.g. `high`). The initial value loads (set before the document filter is
  installed), but the field rejects non-numeric typed edits. Likely a copy-paste from the numeric
  rows; worth a separate fix.
</content>
</invoke>
