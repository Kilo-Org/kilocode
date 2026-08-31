# JetBrains: Integrations settings page with a GitHub integration toggle

## Goal

Add an **Integrations** configurable under Settings → Tools → Kilo Code, positioned directly after **Context**, containing a **GitHub** section with a single boolean setting (default **on**).

When the setting is off:

- The plugin never spawns `gh`. No PR polling, no `gh auth status`, no `gh pr view/list`.
- In-flight gh work is cancelled, timers are stopped, and cached PR state is cleared so nothing leaks.
- PR badges, PR titles on worktree editor tabs, PR context actions, and the "Import from Pull Request" tab disappear.
- Git-only features (worktree list, stats, dirty counts, branch name, branch dock, diff) keep working unchanged.
- The `gh` missing / unauthorized banner disappears.

The `gh`/`git` warning banner gains a third action, **Turn off GitHub integration**, with a tooltip naming the settings location.

## Decisions taken

These were resolved without user input; flag them if you disagree before implementing.

| Decision | Choice | Rationale |
|---|---|---|
| Git detection while off | Keep a git-only probe: add `github: Boolean = true` to `ghStatus`/`branchStatus`; when false the backend runs only `git --version` and never spawns `gh` | `GIT_MISSING` currently comes from `probeGh`'s `git --version` step and drives both the "Git not found" banner and `BranchDock.gitAvailable()`. Dropping it would silently break both. One `git --version` per 60s is dwarfed by the existing 30s git stats poll. |
| "Import from PR" tab | Hidden while off | It calls `importPr`, which hard-fails with "GitHub CLI (gh) is not installed/authorized". Leaving it would offer a guaranteed failure. |
| Persistence | App-level `KiloPluginSettings` key `kilo.integrations.github` (PropertiesComponent), default `true` | Matches the existing local-boolean pattern; `GhStatusCoordinator` is already an app service, so lifetimes line up. |
| Page style | Plain `SearchableConfigurable` with an immediate-write toggle, **not** `DraftReadyConfigurable` | The setting is purely local. A `KiloReadyConfigurable` would render "CLI unavailable" until the CLI is ready, which is wrong for an IDE-local preference. |
| Disable button on `GIT_MISSING` | Not shown | Git is not the GitHub integration; turning it off would not fix a missing git. |

No `kilocode_change` markers are needed: everything is under `packages/kilo-jetbrains/`, which is Kilo-owned.

## Ordered tasks

### 1. Setting + change notification

**`frontend/src/main/kotlin/ai/kilocode/client/plugin/KiloPluginSettings.kt`**

Add, following the existing triple pattern:

```kotlin
private const val GITHUB_KEY = "kilo.integrations.github"

fun getGithub(): Boolean = PropertiesComponent.getInstance().getBoolean(GITHUB_KEY, true)

fun setGithub(value: Boolean) {
    PropertiesComponent.getInstance().setValue(GITHUB_KEY, value.toString())
}

internal fun unsetGithub() {
    PropertiesComponent.getInstance().unsetValue(GITHUB_KEY)
}
```

**New file `frontend/src/main/kotlin/ai/kilocode/client/agentManager/worktree/GithubIntegrationListener.kt`**

Placed next to `GhStatusListener` because every consumer lives in that package (mirrors `session/settings/ApprovalReasonVisibilityListener.kt`).

```kotlin
fun interface GithubIntegrationListener {
    fun changed(enabled: Boolean)

    companion object {
        @JvmField
        val TOPIC: Topic<GithubIntegrationListener> = Topic.create(
            "Kilo github integration",
            GithubIntegrationListener::class.java,
        )
    }
}

/** Single write path: persists, publishes, and records the surface that flipped it. */
@RequiresEdt
internal fun setGithubIntegration(enabled: Boolean, surface: String) {
    if (KiloPluginSettings.getGithub() == enabled) return
    KiloPluginSettings.setGithub(enabled)
    Telemetry.send("Github Integration Toggled", mapOf("enabled" to enabled.toString(), "surface" to surface))
    ApplicationManager.getApplication().messageBus
        .syncPublisher(GithubIntegrationListener.TOPIC)
        .changed(enabled)
}
```

`Telemetry.send` takes `Map<String, String>`, so stringify the boolean. Telemetry failures are caught and logged inside `KiloTelemetryService`, so tests that click the banner link are safe.

### 2. RPC contract

**`shared/src/main/kotlin/ai/kilocode/rpc/KiloWorktreeRpcApi.kt`**

```kotlin
suspend fun ghStatus(directory: String, github: Boolean = true): GhAvailability
suspend fun branchStatus(directory: String, github: Boolean = true): BranchStatusDto
```

Document that `github = false` means "resolve git state only; never spawn `gh`".

`prStatus` is **not** changed — the frontend simply stops calling it while the integration is off.

### 3. Backend

**`backend/src/main/kotlin/ai/kilocode/backend/rpc/KiloWorktreeRpcApiImpl.kt`**

- `probeGh(base, reason, github: Boolean)`:
  - keep the existing directory-exists check and the `git --version` step that yields `GIT_MISSING`;
  - when `github` is false, return `GhAvailability.OK` right after the git check — no `gh auth status`, and **no** `ghCache` read or write (avoids mixing git-only verdicts into the shared 3s cache);
  - when `github` is true, behave exactly as today.
- `ghAvailable(base, github: Boolean)`: when `github` is false, delegate to `probeGh(..., github = false)` and skip the `gh --version` / `ghProbe` path entirely (a git-only probe can never return `MISSING`, so that branch is unreachable anyway — make it explicit).
- `ghStatus(directory, github)`: `withContext(Dispatchers.IO) { probeGh(dir, "rpc", github) }`.
- `branchStatus(directory, github)`:
  - key the `branches` cache by `"$directory|$github"` so flipping the setting cannot serve a cross-mode entry;
  - still run `git branch --show-current` and `isLinkedWorktree()`;
  - call `ghAvailable(root, github)`;
  - call `resolver.resolve(...)` only when `github` is true; otherwise `pr = null`.
- Leave `prStatus`, `importPr`, `invalidate()`, and `PrResolver` untouched.

### 4. Frontend client wrapper

**`frontend/.../agentManager/worktree/KiloWorktreeService.kt`**

Thread the new parameter through `ghStatus(directory, github)` and `branchStatus(directory, github)`. Keep the existing "do not swallow" semantics and the doc comments explaining why.

### 5. `GhStatusCoordinator` — stop probing gh, cancel in-flight work

**`frontend/.../agentManager/worktree/GhStatusCoordinator.kt`**

- Add `private var github = KiloPluginSettings.getGithub()` and `private var job: Job? = null`.
- Subscribe once in the primary constructor: `ApplicationManager.getApplication().messageBus.connect(cs).subscribe(GithubIntegrationListener.TOPIC, GithubIntegrationListener { edt { github(it) } })`. Precedent for a scope-bound connection: `backend/.../run/WorktreeRunManager.kt:319`. The test constructor delegates to the primary, so the subscription is live in tests.
- `probe(reason)`: store the launched coroutine in `job` and pass `github` to `ghStatus(dir, github)`.
- `detachEdt`: also `job?.cancel(); job = null` alongside the existing timer stop and `busy = false` reset.
- New `@RequiresEdt private fun github(enabled: Boolean)`:
  - assign the field;
  - when disabling: `job?.cancel(); job = null; busy = false; notified = false; generation++`, then `apply(target(), GhAvailability.OK)` so the banner hides immediately instead of waiting for a probe, then `schedule()`;
  - when enabling: `notified = false`, then `probe("github-enabled")` for an immediate re-check.
- `apply(project, next)`: when `!github`, ignore any non-`OK`, non-`GIT_MISSING` value. This guards against an `in-flight` `prStatus` from another project resolving into `report()` after the user disabled the toggle.
- `baseDelay()`: return `SLOW` when `!github` (the loop only checks git at that point).
- `notify(...)`: unreachable for gh states while disabled; no change needed.

### 6. `WorktreeStatusService` — stop PR polling, clear PR state

**`frontend/.../agentManager/worktree/WorktreeStatusService.kt`**

- Add `private var github = KiloPluginSettings.getGithub()` and `private var prJob: Job? = null`.
- Subscribe via `ApplicationManager.getApplication().messageBus.connect(cs)` to `GithubIntegrationListener.TOPIC`.
- `refreshPr(force)`: early-return when `!github`.
- `loadPr()`: assign the launched coroutine to `prJob`.
- `start()`: create `prTimer` only when `github`; still do the immediate `refreshPr(force = true)` (a no-op when disabled).
- `stop()`: also `prJob?.cancel(); prJob = null`.
- On `changed(false)`: `prTimer?.stop(); prTimer = null; prJob?.cancel(); prJob = null; prFlow.value = emptyMap(); ghFlow.value = GhAvailability.OK; lastPr = 0`.
- On `changed(true)`: when `refs > 0`, start `prTimer` and `refreshPr(force = true)`.

Clearing `prFlow` propagates through `WorktreeStatusBinding` → `AgentManagerPanel.prs = emptyMap()` → `sync()`, which already calls `service<WorktreeNameCache>().putPr(item.path, pull)` with a nullable `pull` (`AgentManagerPanel.kt:471`) and `putPr` removes on null (`WorktreeNameCache.kt:38-49`). So worktree editor tab titles revert from PR titles to worktree names with **no** change in `AgentManagerPanel`. Verify this while implementing; add an explicit clear only if it does not hold.

### 7. `GhBanner` — third action with tooltip

**`frontend/.../agentManager/worktree/GhBanner.kt`**

In `sync(next)`, after the existing action labels, when `next` is `MISSING` or `UNAUTH`:

```kotlin
createActionLabel(KiloBundle.message("worktree.gh.disable")) {
    setGithubIntegration(false, "worktree_gh_banner")
}.toolTipText = KiloBundle.message("worktree.gh.disable.tooltip")
```

`EditorNotificationPanel.createActionLabel(String, Runnable)` returns `HyperlinkLabel`, so `toolTipText` is available. No explicit hide is needed: the coordinator publishes `OK`, which routes into the existing `render(OK)` path and hides the panel.

Do not add the label for `GIT_MISSING`.

### 8. `SessionUi` — branch dock without gh

**`frontend/.../session/SessionUi.kt`**

- `refreshBranch()`: pass `KiloPluginSettings.getGithub()` to `branchStatus(workspace.directory, github)`.
- On the existing app message-bus connection (the same block that subscribes `ApprovalReasonVisibilityListener` around line 808), subscribe `GithubIntegrationListener.TOPIC` and call `refreshBranch()`. `refreshBranch()` already cancels `branchJob` first, so a flip cancels the in-flight gh call and re-reads git-only state. `pr` becomes null, so the PR badge and the `OpenSessionPrAction` / `CopySessionPrRefAction` context actions go away; `availability` stays `OK`, so the dock keeps working.

### 9. `NewWorktreeDialog` — hide the PR tab

**`frontend/.../agentManager/worktree/NewWorktreeDialog.kt`**

In `tabs()` (line ~175), build and `addTab(pr)` only when `KiloPluginSettings.getGithub()`. `submit()`'s `DialogTab.PR` branch then becomes unreachable; leave it. The `worktree.import.pr.*` bundle keys stay.

### 10. Settings page

**New `frontend/.../settings/integrations/IntegrationsSettingsUi.kt`** (`internal`)

`internal class IntegrationsSettingsUi : SettingsPanel(), Disposable`:

- Build a `BaseContentPanel` with one `section(KiloBundle.message("settings.integrations.github.title"), KiloBundle.message("settings.integrations.github.description"))` and a single `SettingsRow(title, description, toggle)`.
- `private val toggle = SettingsToggle(KiloPluginSettings.getGithub()) { setGithubIntegration(it, "settings") }`.
- `setContent(content)`.
- Subscribe `GithubIntegrationListener.TOPIC` on `ApplicationManager.getApplication().messageBus.connect(this)` and re-sync `toggle.isSelected` so a flip from the banner is reflected in an open settings page.
- `@RequiresEdt fun sync() { toggle.isSelected = KiloPluginSettings.getGithub() }`.
- `override fun dispose() = Unit` (the bus connection is disposed with `this`).

**New `frontend/.../settings/integrations/IntegrationsConfigurable.kt`** (public — XML instantiates it)

```kotlin
class IntegrationsConfigurable : SearchableConfigurable, Configurable.NoMargin, Configurable.NoScroll {
    private var ui: IntegrationsSettingsUi? = null

    override fun getId(): String = ID
    override fun getDisplayName(): String = KiloBundle.message("settings.integrations.displayName")
    override fun createComponent(): JComponent = IntegrationsSettingsUi().also { ui = it }
    override fun isModified(): Boolean = false
    override fun apply() = Unit
    override fun reset() { ui?.sync() }
    override fun disposeUIResources() {
        ui?.let { Disposer.dispose(it) }
        ui = null
    }

    companion object {
        const val ID = "ai.kilocode.jetbrains.settings.integrations"
    }
}
```

`NoMargin` + `NoScroll` because `SettingsPanel` owns its insets and its own `JBScrollPane` (`SettingsPanel.kt:19-45`), matching `KiloReadyConfigurable`.

### 11. Registration and navigation

**`frontend/src/main/resources/kilo.jetbrains.frontend.xml`**

Insert after the Context entry and renumber Advanced so Integrations lands between them:

```xml
<applicationConfigurable
        parentId="ai.kilocode.jetbrains.settings"
        id="ai.kilocode.jetbrains.settings.integrations"
        groupWeight="-2"
        instance="ai.kilocode.client.settings.integrations.IntegrationsConfigurable"
        bundle="messages.KiloBundle"
        key="settings.integrations.displayName"/>
```

Change the existing Advanced entry's `groupWeight` from `-2` to `-3`.

**`frontend/.../settings/KiloSettingsConfigurable.kt`**

Add an `ActionLink` for Integrations between the `context` and `advanced` links (lines 86-100), using the same shape as the surrounding links plus the `IntegrationsConfigurable` import.

### 12. Bundle keys

**`frontend/src/main/resources/messages/KiloBundle.properties`**

```properties
settings.integrations.displayName=Integrations
settings.integrations.github.title=GitHub
settings.integrations.github.description=Kilo uses the GitHub CLI (gh) to resolve pull requests for worktrees.
settings.integrations.github.enabled.title=Enable GitHub Integration
settings.integrations.github.enabled.description=Run gh to show pull request badges on worktrees and to import a pull request into a worktree. When off, Kilo never runs gh.
worktree.gh.disable=Turn off GitHub integration
worktree.gh.disable.tooltip=You can turn this back on in Settings | Tools | Kilo Code | Integrations.
```

Keep the values free of apostrophes — `KiloBundleLocaleTest` asserts apostrophes are doubled. The 18 `KiloBundle_<locale>.properties` files can be left alone; `ResourceBundle` parent chaining falls back to the base bundle for missing keys. Adding translations is optional and follows the existing practice for `worktree.gh.*`.

### 13. Tests

**`frontend/src/test/.../testing/FakeWorktreeRpcApi.kt`** — record the `github` flag on `ghStatus` and `branchStatus` calls (e.g. change `ghCalls` to carry the flag, add a `branchCalls` list). Keep `assertNotEdt(...)` on every method.

**New `frontend/src/test/.../settings/integrations/IntegrationsConfigurableTest.kt`** (`BasePlatformTestCase`)

- `IntegrationsConfigurable.ID` equals the XML id.
- Default state renders one toggle that is selected (default on).
- Toggling writes `KiloPluginSettings.getGithub() == false` and publishes `GithubIntegrationListener.TOPIC` once.
- `isModified()` is false and `apply()` is inert (the write is immediate).
- `reset()` re-syncs the toggle after an external `setGithubIntegration` call.
- `tearDown` calls `KiloPluginSettings.unsetGithub()`.

**`frontend/src/test/.../settings/KiloSettingsConfigurableTest.kt`** — add the Integrations ID assertion and update the link-order list at line ~118 to `[..., "Auto-Approve", "Context", "Integrations", "Advanced"]`.

**`frontend/src/test/.../agentManager/worktree/GhStatusCoordinatorTest.kt`** — add:

- while disabled, `ghStatus` is invoked with `github = false` and the loop uses the slow cadence;
- disabling while `UNAUTH` publishes `OK` immediately, cancels the in-flight probe, and no further gh-mode calls occur;
- re-enabling probes immediately with `github = true`;
- `report(project, UNAUTH)` while disabled publishes nothing.

**`frontend/src/test/.../agentManager/worktree/GhBannerTest.kt`** — add:

- `MISSING` and `UNAUTH` render a "Turn off GitHub integration" link whose `toolTipText` is the settings-location message;
- clicking it sets the setting to false and hides the panel;
- `GIT_MISSING` does not render that link.

**`frontend/src/test/.../agentManager/worktree/WorktreeStatusServiceTest.kt`** — add:

- attaching while disabled performs no `prStatus` call and starts no PR timer, while stats/dirty still load;
- disabling after attach clears the `pr` flow, resets `gh` to `OK`, and stops the PR timer;
- re-enabling forces one immediate PR load and restarts the timer.

**`frontend/src/test/.../agentManager/worktree/NewWorktreeDialogTest.kt`** (or the existing dialog test) — the PR tab is absent while disabled and present by default.

**`backend/src/test/.../rpc/KiloWorktreeRpcApiImplTest.kt`** — add a temp-repo test asserting `branchStatus(dir, github = false)` returns the current branch and worktree flag with `availability = OK` and `pr = null`, and that `ghStatus(dir, github = false)` returns `OK`.

Any new test that flips the setting must call `KiloPluginSettings.unsetGithub()` in `tearDown`.

### 14. Changeset

Add `.changeset/jetbrains-github-integration-toggle.md`:

```markdown
---
"@kilocode/kilo-jetbrains": minor
---

Add an Integrations settings page with a GitHub toggle. Turning it off stops Kilo from running the GitHub CLI, hides pull request badges and pull request import, and can be done straight from the gh warning banner.
```

`@kilocode/kilo-jetbrains` changesets are established practice (see `.changeset/jetbrains-worktree-run-configs.md`).

## Risks and edge cases

- **Cross-mode cache poisoning.** The backend's `ghCache` is a single global `Timed<GhAvailability>`, not keyed by directory or mode. Skipping the cache entirely on the git-only path is what keeps a git-only `OK` from masking a real `UNAUTH` after the user re-enables. Do not "optimize" this by caching the git-only verdict.
- **`branches` cache.** Must include the mode in the key, otherwise a disabled-mode entry (`pr = null`) can be served for up to 90s after re-enabling, and vice versa.
- **In-flight `prStatus` after disable.** `WorktreeStatusService.loadPr()` calls `GhStatusCoordinator.report(...)`. Cancelling `prJob` plus the coordinator's `!github` guard in `apply` are both required; either alone leaves a window where a stale `UNAUTH` re-shows the banner.
- **Constructor subscriptions.** Both services subscribe in their constructors via `messageBus.connect(cs)`. This is one cheap call, but keep it to that — AGENTS.md forbids heavy service-constructor work.
- **`GhAvailability` enum is unchanged.** No `DISABLED` value is introduced, so no exhaustive `when` in `GhBanner`, `baseDelay`, `BranchDock`, or `EmptySessionPanel` needs new branches.
- **Ordering coupling.** `groupWeight` in the XML, the root-page link order in `KiloSettingsConfigurable.createComponent()`, and the assertion in `KiloSettingsConfigurableTest` must all be updated together.

## Validation

From `packages/kilo-jetbrains/` (requires Java 21):

```
./gradlew typecheck
./gradlew test
```

Manual check via `./gradlew runIde`:

1. Settings → Tools → Kilo Code shows **Integrations** between Context and Advanced, with GitHub enabled.
2. With `gh` logged out, the Agent Manager banner shows Authorize / Learn more / **Turn off GitHub integration**, and hovering the last one shows the settings path.
3. Clicking it hides the banner immediately, drops PR badges, reverts worktree tab titles, and removes the Pull Request tab from the new-worktree dialog.
4. Worktree stats, dirty counts, branch name, and the branch dock still work.
5. Re-enabling from the Integrations page restores badges and the banner within one probe.
6. With GitHub off, confirm via `ps`/logs that no `gh` process is spawned over several poll intervals.
