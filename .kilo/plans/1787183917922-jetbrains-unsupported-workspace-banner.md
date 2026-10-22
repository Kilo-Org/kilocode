# Show unsupported workspace via the standard session error banner + fit-to-transcript error height (JetBrains)

## Goal

1. When a JetBrains workspace directory is unsupported for the host-side CLI
   runtime (devcontainer / WSL / invalid virtual path), surface it through the
   existing in-session connection banner (`ConnectionPanel`) instead of silently
   showing "Loading…" forever. It gets the **same** recovery options as other
   connection errors (Try again → Retry / Restart / Reinstall Core).
2. Change the expanded error/detail area so it **fits the whole detail text**,
   capped to the **available height of the session transcript area** (instead of
   the current fixed 10-line cap). This becomes the default behavior for **all**
   connection error/warning banners, not just unsupported.

## Background / Current State

- Detection already works end to end. `RemoteDirectory.detect()` returns a reason
  code and `KiloBackendWorkspace` sets `KiloWorkspaceState.Unsupported(reason)`,
  mapped to `KiloWorkspaceStateDto(status = UNSUPPORTED, error = reason)`
  (`KiloWorkspaceRpcApiImpl.kt:507`). Reason string is in the DTO `error` field.
  Reason codes: `devcontainer_virtual_filesystem`, `wsl_virtual_filesystem`,
  `invalid_virtual_path`.
- The DTO reaches `SessionModel.workspace`; `syncConnectionState()` already runs
  on every `WorkspaceChanged` (`SessionController.kt:982-984`).
- **Gap:** `SessionController.resolveConnectionState()` (`SessionController.kt:2353-2393`)
  has no `UNSUPPORTED` branch, so it falls through to `ShowConnecting`
  (line 2392) → banner reads "Loading…" indefinitely.
- Banner renderer is `ConnectionPanel` (`session/ui/ConnectionPanel.kt`), driven
  by `ConnectionChanged.ShowError/ShowWarning/…`. Its "Try again" link opens a
  popup with Retry / Restart / Reinstall (`recoveryGroup()`).
- Height cap today: `DETAILS_LINES = 10` (line 45). `scrollHeight()` coerces the
  row count to `1..DETAILS_LINES` (line 304), `getPreferredSize()` uses it
  (line 295-301), and `maxExpandedHeight()` (line 345) exposes the fixed cap.
- Overlay placement: `SessionUi.kt:442-452` anchors the banner just above the
  prompt using `child.preferredSize.height` as the banner height; bottom edge is
  `promptTop - gap`, and it grows upward.

All touched files are Kilo-owned JetBrains frontend paths — no `kilocode_change`
markers required. No backend / shared DTO changes needed.

## Design Decisions

- **Unsupported reuses the standard `ShowError` path unchanged** — same red
  banner, same "Try again" popup (Retry / Restart / Reinstall). No new event
  type and no `retry` flag. (Reverses the earlier "hide retry" idea per user.)
- **Detail area fits the full text, capped to available transcript height.**
  Remove the fixed 10-line cap in `ConnectionPanel` so preferred height reflects
  the whole detail text; clamp the rendered banner height to the transcript space
  above the prompt in the overlay layout (where pane geometry is known). The
  existing internal `JBScrollPane` (`VERTICAL_SCROLLBAR_AS_NEEDED`) scrolls the
  overflow. This applies to every error/warning banner uniformly.

## Implementation Tasks

1. **`SessionController.resolveConnectionState()`** (`SessionController.kt:2353`)
   - Add a branch for `workspace.status == KiloWorkspaceStatusDto.UNSUPPORTED`
     (place it next to the workspace `ERROR` branch, before the READY branches):
     - summary = `KiloBundle.message("session.connection.unsupported")`
     - detail = reason mapped to a localized string (helper below), falling back
       to the raw `workspace.error`
     - `source = "workspace"` (retry link shows by default; no flag change)
   - Add a private helper (single-word name, e.g. `unsupported`) mapping the
     `workspace.error` reason code to a bundle string:
     - `devcontainer_virtual_filesystem` → `session.connection.unsupported.devcontainer`
     - `wsl_virtual_filesystem` → `session.connection.unsupported.wsl`
     - `invalid_virtual_path` → `session.connection.unsupported.invalid`
     - else → `session.connection.unsupported.unknown` (or raw reason)

2. **`KiloBundle.properties`** (`resources/messages/`, after line 17)
   - Add (finalize exact copy during implementation):
     - `session.connection.unsupported=Workspace not supported`
     - `session.connection.unsupported.devcontainer=Dev Container virtual filesystem paths can't be reached by the host-side Kilo runtime.`
     - `session.connection.unsupported.wsl=WSL virtual filesystem paths aren't supported by the host-side Kilo runtime.`
     - `session.connection.unsupported.invalid=This workspace path can't be resolved on the local filesystem.`
     - `session.connection.unsupported.unknown=This workspace isn't supported by the host-side Kilo runtime.`

3. **`ConnectionPanel.kt`** (`session/ui/`) — remove the fixed cap so details fit
   the whole text:
   - Delete `DETAILS_LINES` (line 45) usage in `scrollHeight()` (line 303-306):
     compute rows from the full logical line count (`coerceAtLeast(1)`), no upper
     bound. `getPreferredSize()` (line 295-301) then reports the full detail
     height when expanded.
   - Remove `maxExpandedHeight()` (line 345) or repurpose it; it encodes the
     10-line cap and is only used by the outgoing test.
   - Leave the `JBScrollPane` policies as-is so overflow scrolls when the overlay
     clamps the banner shorter than preferred.
   - Note (known limitation, keep behavior parity): row count uses logical lines,
     not wrapped visual lines, so a wrapped long line may under-estimate height;
     the scrollbar still covers overflow. Optional follow-up only.

4. **`SessionUi.kt`** overlay layout for `connection` (lines 442-452) — clamp the
   banner height to the transcript area above the prompt:
   - `full = child.preferredSize.height`
   - `avail = (point.y - gap).coerceAtLeast(0)` (space from pane top to just above
     the prompt)
   - `h = full.coerceAtMost(avail)`
   - Rectangle: `x = point.x + gap`, `y = point.y - h - gap`,
     `width = (prompt.width - gap*2).coerceAtLeast(0)`, `height = h`
   - This keeps the bottom anchored at `promptTop - gap` (unchanged) while
     preventing the top from overflowing above the transcript region; the panel's
     internal scroll pane handles the remainder. Applies to every banner state.

## Tests

- **`ConnectionDelayTest.kt`** (`session/controller/`): add a test mirroring
  `test persistent workspace error is delayed` — set
  `projectRpc.state.value = KiloWorkspaceStateDto(status = UNSUPPORTED, error = "wsl_virtual_filesystem")`,
  assert a `ShowError` with summary "Workspace not supported", the mapped WSL
  detail, and `source == "workspace"`; assert it no longer resolves to
  `ShowConnecting`.
- **`ConnectionPanelTest.kt`** (`session/ui/`):
  - Replace `test expanded details height is capped at ten lines` (lines 140-150)
    with a test asserting the expanded preferred height grows with the full text
    (e.g. 30 lines yields a preferred height clearly larger than the old
    10-line height / a computed full-text height), i.e. no fixed cap.
  - Optionally add a small test that an unsupported-style `ShowError` still shows
    the retry link and uses the Core recovery group (parity with existing
    `test retry popup group uses core recovery actions`).
- **`SessionUiLayoutTest.kt`**: add a test that with a large detail body and a
  constrained root/pane height, the expanded banner is clamped to the transcript
  area — `connection.y >= 0` (does not overflow above the transcript), bottom
  still anchored at `promptTop - gap`, `detailsVisible()` true, and the internal
  `JBScrollPane` shows/needs its vertical scrollbar. Reuse the anchoring
  assertions from `test expanded connection panel remains anchored above prompt`
  (lines 261-276).

## Validation

From `packages/kilo-jetbrains/`:
- `./gradlew typecheck`
- `./gradlew test` (or targeted: `ConnectionPanelTest`, `ConnectionDelayTest`,
  `SessionUiLayoutTest`)

Requires Java 21; only check Java if Gradle fails with a Java-version error.

## Risks / Notes

- Removing the fixed cap changes sizing for **all** connection banners; the
  overlay clamp is what bounds it, so verify very long errors scroll rather than
  push the banner off the top of the transcript.
- No backend / shared DTO changes; `UNSUPPORTED` + `error=reason` already reach
  the frontend.
- Reason codes live only in `RemoteDirectory.kt` today; the new bundle keys are
  the first human-readable mapping. New reason codes fall back to `unknown`.

## Open Questions

- Exact user-facing wording for the five `session.connection.unsupported*`
  strings (placeholder copy above).
