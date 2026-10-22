# JetBrains: graceful "Dev Container not supported" workspace notice

## Goal

When a JetBrains project is opened so that its directory is a **local-IDE + virtual (IJent) path** — e.g. `/$devcontainer.ij/<id>@…podman.sock/…` (the "Model 2" case) — the host-side Kilo CLI cannot resolve the directory, so agent resolution returns HTTP 500 and the workspace fails to load. Today this surfaces as a generic red "Workspace loading failed" banner with a futile "Try again".

Replace that with a clear, non-error notice that:
- explains Kilo can't access the project because it's opened through a Dev Container / remote virtual filesystem, and
- recommends running Kilo **inside the container** via JetBrains Remote Development (backend-in-container, the validated "Model 1" flow) as the preferred way, and
- offers a "Learn more" link.

Detection short-circuits workspace load **before** the 3× `/agent` 500 retries.

## Background (verified in code)

- Backend workspace load: `packages/kilo-jetbrains/backend/src/main/kotlin/ai/kilocode/backend/workspace/KiloBackendWorkspace.kt` (`load()` fetches agents/providers/commands/skills; failure → `KiloWorkspaceState.Error`).
- Backend state model: `.../backend/workspace/KiloWorkspaceState.kt` (`Pending/Loading/Ready/Error`).
- RPC DTO: `packages/kilo-jetbrains/shared/src/main/kotlin/ai/kilocode/rpc/dto/KiloWorkspaceStateDto.kt` (`KiloWorkspaceStatusDto = PENDING/LOADING/READY/ERROR`).
- DTO mapping (exhaustive `when` over sealed state): `.../backend/rpc/KiloWorkspaceRpcApiImpl.kt` `dto(state)` (~line 493). Directory resolution `resolveProjectDirectory` returns `project.basePath`; `localConfig` (~line 343) already throws `InvalidPathException` for IJent paths.
- Frontend mapping to UI: `.../frontend/.../session/controller/SessionController.kt` `resolveConnectionState()` (~line 2270) maps `workspace.status == ERROR` → `ConnectionChanged.ShowError`; `retryConnection` reloads the workspace when status is ERROR (~line 622).
- Connection banner UI: `.../frontend/.../session/ui/ConnectionPanel.kt` (red/warning label + expandable details + "Try again" `ActionLink`). Events defined in `.../session/controller/SessionControllerEvent.kt` (`ConnectionChanged.{Hide,ShowConnecting,ShowDownloading,ShowError,ShowWarning}`).
- Strings: `.../frontend/src/main/resources/messages/KiloBundle.properties` (`session.connection.*`). Only the base bundle needs new keys; other locales fall back.
- This builds on the committed fix (`fix(jetbrains): don't surface workspace fetch failures as IDE errors`); genuine 500s from *real* directories keep the existing Error path.

## Design decisions

1. **Representation: dedicated non-error state (recommended).** Add a new workspace status rather than reusing `ERROR`, so the UI is informational (not red), retry is suppressed, and there is no 500/log/retry spam.
2. **Detection lives in the backend workspace load path**, keyed on the directory string, run before any fetch. Global app load stays `READY` (providers/config are global and unaffected).
3. **Detection signals (low false-positive):**
   - Directory contains the marker `/$devcontainer.ij/`, or
   - starts with a WSL root `\\wsl$\` or `\\wsl.localhost\`, or
   - `java.nio.file.Path.of(directory)` (or normalize) throws `InvalidPathException`.
   Do **not** trigger solely on "path doesn't exist" (avoids false positives on transient FS states / real paths). Real container paths (Model 1, e.g. `/workspaces/podman`) and normal local paths never match.
4. **Retry:** hidden for the unsupported state (deterministic; reload would re-detect). The workspace re-evaluates naturally when the directory changes (new workspace instance).
5. **Link:** a single "Learn more" hyperlink. Default target `https://kilo.ai/docs/jetbrains/dev-containers` (see Open items — confirm/replace). Keep the URL as one constant so it's trivial to change.
6. **Localization:** add keys to base `KiloBundle.properties` only.

## Implementation tasks (ordered)

### 1. Shared DTO
- `shared/.../rpc/dto/KiloWorkspaceStateDto.kt`: add `UNSUPPORTED` to `KiloWorkspaceStatusDto`. Reuse the existing `error: String?` field to carry a short reason code/message (no new field required); keep `errors` empty for this state.

### 2. Backend state + detection
- `backend/.../workspace/KiloWorkspaceState.kt`: add `data class Unsupported(val reason: String) : KiloWorkspaceState()`.
- Add a small pure, unit-testable helper (single-word-friendly names), e.g. `RemoteDirectory.detect(directory: String): String?` returning a reason string when the directory is an unsupported virtual/IJent path, else `null`. Place it in `backend/.../workspace/` (backend-owned; no `kilocode_change` marker needed — new Kilo file in the Kilo plugin).
- `backend/.../workspace/KiloBackendWorkspace.kt`: at the very start of `load()`, if `RemoteDirectory.detect(directory) != null`, set `_state.value = KiloWorkspaceState.Unsupported(reason)`, log a single `info`/`warn` line (not `error`), and return without fetching. Ensure no fetch/retry runs.

### 3. Backend RPC mapping
- `backend/.../rpc/KiloWorkspaceRpcApiImpl.kt` `dto(state)`: add branch `is KiloWorkspaceState.Unsupported -> KiloWorkspaceStateDto(status = UNSUPPORTED, error = state.reason)`.

### 4. Frontend event + controller
- `frontend/.../session/controller/SessionControllerEvent.kt`: add `data class ShowNotice(val summary: String, val detail: String?, val learnMoreUrl: String? = null) : ConnectionChanged()`.
- `frontend/.../session/controller/SessionController.kt`:
  - `resolveConnectionState()`: add a branch for `workspace.status == KiloWorkspaceStatusDto.UNSUPPORTED` (place before the generic ERROR branch) returning `ShowNotice(summary=…, detail=…, learnMoreUrl=…)` using new bundle keys.
  - `retryConnection()` / retry path (~line 622): do **not** call `workspace.reload()` when status is `UNSUPPORTED`.
  - Confirm `WorkspaceChanged` handling (~line 933) already no-ops for non-READY (it does).

### 5. Frontend rendering
- `frontend/.../session/ui/ConnectionPanel.kt`: handle `ConnectionChanged.ShowNotice`:
  - Info styling (secondary/label foreground, not `errorLabelForeground`).
  - Show the guidance text; keep `detail` in the expandable area if used.
  - Render a "Learn more" link via platform `HyperlinkLabel`/`ActionLink` that opens `learnMoreUrl` with `BrowserUtil.browse(url)`.
  - Hide the "Try again" retry link for this event.

### 6. Strings
- `frontend/.../messages/KiloBundle.properties`: add keys, e.g.:
  - `session.connection.notice.devcontainer.summary=Kilo can't access this Dev Container project`
  - `session.connection.notice.devcontainer.detail=This project is opened through a Dev Container/remote virtual filesystem that the Kilo runtime on your machine can't reach. Run Kilo inside the container using JetBrains Remote Development (the IDE backend runs in the container) — that's the recommended way. Local projects also work.`
  - `session.connection.notice.learnMore=Learn more`
- Store the docs URL as a Kotlin constant referenced by the controller (single source), not in the bundle.

### 7. Tests
- Backend `backend/src/test/.../workspace/KiloBackendWorkspaceTest.kt`:
  - Given directory `/$devcontainer.ij/abc@…podman.sock/IdeaProjects/x`, workspace state becomes `Unsupported`; assert **no** `/agent` request hit the mock CLI (via `MockCliServer` request log), no retries, and no `ERROR`/500 log lines.
  - Add a `\\wsl$\Ubuntu\home\x` case and an `InvalidPathException`-triggering case.
  - Negative: a normal local dir and a real `/workspaces/...`-style dir still load normally (existing tests cover normal load).
- Add/extend a mapping assertion: `Unsupported` → `KiloWorkspaceStateDto(status=UNSUPPORTED, error=reason)`.
- Frontend `frontend/src/test/.../session/ui/ConnectionPanelTest.kt`: `ShowNotice` renders info label (not error color), shows the summary, exposes the "Learn more" link, and hides retry.
- Frontend controller test (`session/controller/…`): `KiloWorkspaceStatusDto.UNSUPPORTED` state produces a `ConnectionChanged.ShowNotice`, and `retryConnection()` does not call `workspace.reload()` for UNSUPPORTED.

### 8. Changeset
- Add `.changeset/<slug>.md` (`"@kilocode/kilo-jetbrains": patch`) describing the user-facing behavior: "Show a clear notice (with guidance to run in a Dev Container) instead of a generic error when a project is opened through a Dev Container/remote virtual filesystem Kilo can't access."

## Out of scope
- Actually supporting Model 2 (running the CLI in-container via Eel/IJent, port forwarding, path translation). This plan only adds graceful communication.
- Hardening every directory-scoped RPC (`models`, file search, git) for virtual paths; they already fail soft. The banner communicates the root cause.

## Failure modes / edge cases
- **False positive** on a legitimate directory: mitigated by marker-only + `InvalidPathException` detection (not "not exists").
- **Model 1 unaffected:** backend runs in the container, directory is real (`/workspaces/...`), markers don't match → normal load.
- **App stays READY:** only the workspace is Unsupported; global providers/config still load, so the rest of the UI (settings, providers) remains usable.
- **New enum value:** update the exhaustive `when` in backend `dto()` (compile-enforced). Frontend status checks are equality-based; add the UNSUPPORTED branch in `resolveConnectionState` and confirm no other exhaustive `when(status)` needs a branch (grep `KiloWorkspaceStatusDto.`).

## Validation
- From `packages/kilo-jetbrains/`: `./gradlew :backend:test --tests ai.kilocode.backend.workspace.KiloBackendWorkspaceTest` and the new frontend tests (`./gradlew :frontend:test --tests …ConnectionPanelTest` and the controller test).
- From `packages/kilo-jetbrains/`: `bun run typecheck` (or `./gradlew typecheck`) and `./gradlew test`.
- Run inspection "Plugin DevKit | Code | Frontend and Backend API Usage" since split-mode code (shared DTO + frontend event) changes.
- Manual (optional): reproduce Model 2 on Linux+rootless Podman (local IDE + IJent path) and confirm the info banner + link appears instead of the red error, with no IDE internal-error popup.

## Open items (non-blocking; recommended defaults chosen)
1. **Docs URL** for "Learn more": default `https://kilo.ai/docs/jetbrains/dev-containers`. Confirm the final path or point to an existing page; may require creating that docs page (in `packages/kilo-docs/`) separately. If source URLs under `packages/kilo-vscode`/`opencode` change this doesn't apply, but if a docs page is added, run `bun run script/extract-source-links.ts` only if a tracked source URL changes.
2. **Optional telemetry:** capture a "Dev Container Unsupported Shown" event via the existing `capture(...)` pattern in `SessionController` when the notice is first shown. Recommended: include it; low cost.
3. **Copy review:** finalize the exact wording of the summary/detail strings.
