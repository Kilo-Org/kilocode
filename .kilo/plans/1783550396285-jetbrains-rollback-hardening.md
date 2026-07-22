# JetBrains Rollback Feature — Hardening Plan

Harden the new JetBrains rollback/redo feature: (1) communicate when only messages were
reverted because snapshots are disabled, and (2–4) close the code-duplication, testing,
end-to-end, and AGENTS-conformance gaps.

All work is inside `packages/kilo-jetbrains/`. No shared `packages/opencode/` files change,
so no `kilocode_change` markers are needed.

## Context an implementer needs

- Revert flow: user clicks the per-message Rollback button (`MessageToolbar`/`MessageView`)
  → `SessionController.revert()` aborts a busy turn then POSTs `/session/:id/revert`
  → CLI sets a revert marker → `SessionUpdated` event → `SessionModel.setRevert()` →
  `RevertBanner` shows + reverted messages hidden. `redo()`/`redoAll()` drive
  `/session/:id/revert` (next user msg) and `/session/:id/unrevert`.
- Snapshot signal: `SessionRevertDto.snapshot` (`shared/.../rpc/dto/SessionDto.kt:22`) is
  `null` exactly when the server did NOT restore files (snapshots disabled: `config.snapshot
  === false`, non-git worktree, or ACP). It is already parsed and reaches the frontend via
  `SessionModel.revert()`. When `snapshot == null` the diff is also empty, so the banner shows
  no file rows today. This is the reliable, no-new-API signal for "history only".
- Test harnesses already exist: frontend `SessionControllerTestBase` + `FakeSessionRpcApi`
  (already tracks `rpc.reverts` and `rpc.unreverts`); backend `MockCliServer` +
  `KiloBackendChatManagerTest`. Banner tests instantiate `RevertBanner(model, redo, redoAll)`
  and read components via `components(banner)`.

## Key files

- `frontend/.../session/ui/RevertBanner.kt`
- `frontend/.../session/controller/SessionController.kt` (`revert`, `unrevert`, `redo`, `redoAll`, `capture`, `sessionProps`)
- `frontend/.../session/model/SessionModel.kt` (`revert()`, `revertedCount()`, `isRevertedMessage()`)
- `frontend/src/main/resources/messages/KiloBundle.properties` (+ translated `KiloBundle_*.properties`)
- `backend/.../app/KiloBackendChatManager.kt` (`revert`/`unrevert`), `backend/.../cli/KiloCliDataParser.kt` (`buildRevertJson`)
- `backend/.../app/KiloBackendSessionManager.kt` (`revertDto` duplication)
- Tests: `frontend/.../session/controller/TurnLifecycleTest.kt` (or new `RevertFlowTest.kt`),
  `frontend/.../session/ui/SessionMessageListPanelTest.kt`,
  `frontend/.../session/model/SessionModelTest.kt`,
  `backend/.../testing/MockCliServer.kt`, `backend/.../app/KiloBackendChatManagerTest.kt`,
  `backend/.../cli/KiloCliDataParserTest.kt`

## Resolved decisions

- **Do NOT hide/disable the Rollback button when snapshots are off.** This matches VS Code and
  keeps history-only revert usable. We only add messaging.
- **Detect "files not restored" via `model.revert()?.snapshot == null`.** No new config/API,
  no shared-code change.
- **Message it in the `RevertBanner`** with a distinct localized line, shown only when
  `snapshot == null`.
- Proactively warning on the button before a revert (needs `config.snapshot`/`vcs` exposed to
  the frontend) is **out of scope**.

---

## Phase 1 — Communicate history-only revert (snapshots disabled)

1. Add bundle key in `KiloBundle.properties` (place near the other `revert.banner.*` keys):
   - `revert.banner.filesNotRestored=Snapshots are off — only the conversation was reverted; your files were not changed.`
   - Add the same key to every translated `KiloBundle_*.properties` file. If translations are
     not available, copy the English value (mirror how the other `revert.banner.*` keys were
     seeded across bundles) so no key is missing.
2. In `RevertBanner.kt`:
   - Add a retained `JBLabel` field `notice` styled like `hint` (`JBFont.small()`), created
     once in `init` and added to `body` after `hint`.
   - In `update()`, after computing `revert`, set
     `notice.isVisible = revert.snapshot == null` and its text to
     `KiloBundle.message("revert.banner.filesNotRestored")`.
   - Color it via a theme API in `applyStyle` (use `UIUtil.getContextHelpForeground()` to match
     the secondary `hint`; do not hardcode a color). Re-evaluate in `applyStyle` alongside
     `hint.foreground`.
   - Keep the existing empty-diff behavior (no file rows) — the notice replaces the missing
     information rather than adding chrome.
3. Remove the redundant `isOpaque = false` on the `body` and `files` `Stack`s (see Phase 4);
   do this while editing the file.

## Phase 2 — Close code-duplication gaps

4. In `KiloBackendSessionManager.kt`, collapse the two identical `revertDto(...)` overloads
   (`SessionRevert` and `GlobalSessionRevert`) into a single private helper that maps the four
   fields (`messageID`, `partID`, `snapshot`, `diff`) from a small shared shape. Simplest
   approach: one private `fun revertDto(messageID: String?, partID: String?, snapshot: String?,
   diff: String?)` returning `SessionRevertDto?` (null when `messageID` is null), and have both
   call sites extract fields from their respective model type. Keep behavior identical; this is
   a pure refactor covered by existing `KiloBackendSessionManagerTest` parsing assertions.

## Phase 3 — Fill testing + end-to-end gaps

### Frontend controller/model logic

5. `SessionModelTest.kt` — add direct model tests:
   - `revertedCount()` returns the number of user messages from the marker to the end
     (build entries `u1,a1,u2,a2`; marker at `u1` → 2; marker at `u2` → 1; marker id absent → 0).
   - `isRevertedMessage()` true for the marker message and everything after, false before.
   - `snapshot`-null marker still yields a non-zero `revertedCount()` (history-only case).
6. `TurnLifecycleTest.kt` (or new `RevertFlowTest.kt`) — add controller tests using `prompted()`:
   - `redo()` reverts to the NEXT user message: seed `u1,a1,u2,a2`, apply marker at `u1`,
     `edt { m.redo() }`, flush → assert `rpc.reverts` last call targets `u2`.
   - `redo()` at the last user message calls unrevert: marker at `u2` → `redo()` → assert
     `rpc.unreverts` recorded and no new revert call.
   - `redoAll()` calls unrevert: assert `rpc.unreverts` contains `("ses_test","/test")`.
   - `unrevert()` clears via RPC: assert `rpc.unreverts` populated.

### Frontend banner → controller wiring (end-to-end within the UI layer)

7. `SessionMessageListPanelTest.kt` — add wiring + history-only tests:
   - Redo button click invokes the controller: build `RevertBanner(model, redo = { redo++ },
     redoAll = { all++ })`, set a marker, `banner...first { text == redo }.doClick()` → assert
     the redo lambda fired; same for Redo All when `revertedCount > 1`.
   - History-only notice: marker with `SessionRevertDto("u1", snapshot = null)` → assert the
     `revert.banner.filesNotRestored` label is visible and no file rows are present.
   - Snapshot-present: marker with `snapshot = "snap1"` → assert the notice label is hidden.

### Full round-trip end-to-end (frontend)

8. Add one `RevertFlowTest` case that exercises the whole loop through `SessionControllerTestBase`:
   - Seed a multi-turn session, `edt { m.revert(userMsgId) }`, flush → assert busy-abort
     ordering + `rpc.reverts`.
   - `emit(SessionUpdated(..., revert = SessionRevertDto(userMsgId, snapshot = "s1")))` →
     assert `model.isRevertedMessage(userMsgId)` and reverted views hidden.
   - Drive Redo All via `m.redoAll()`; `emit(SessionUpdated(..., revert = null))` → assert
     messages restored (`isRevertedMessage` false) and marker cleared.
   Use existing `emit`/`flush` helpers; no timeouts.

### Backend HTTP contract

9. `MockCliServer.kt` — add routing + capture fields (the current generic `/session/ses_*`
   regexes are full-match and won't catch the `/revert` suffix, so new cases are safe):
   - Fields: `lastRevertPath`, `lastRevertBody`, `lastUnrevertPath`, `lastUnrevertBody`
     (`@Volatile var ... : String? = null`).
   - Cases (place beside the `summarize`/`prompt_async` cases):
     - `bare.matches(Regex("/session/ses_[^/]+/revert")) && method == "POST"` → store path+body,
       `respond(output, 200, sessionCreate)`.
     - `bare.matches(Regex("/session/ses_[^/]+/unrevert")) && method == "POST"` → store path+body,
       `respond(output, 200, sessionCreate)`.
10. `KiloBackendChatManagerTest.kt` — mirror the existing `compact posts summarize request` test:
    - `revert posts messageID and partID to revert endpoint`: call
      `chat.revert("ses_abc", "/test/project", "msg1", "prt1")`; assert
      `requestCount("/session/ses_abc/revert") == 1`, path starts with
      `/session/ses_abc/revert?directory=`, body == `{"messageID":"msg1","partID":"prt1"}`.
    - `revert omits partID when null`: body == `{"messageID":"msg1"}`.
    - `unrevert posts empty body to unrevert endpoint`: body == `{}` and path prefix asserted.
11. `KiloCliDataParserTest.kt` — add `buildRevertJson` unit tests:
    - `buildRevertJson("m1", null) == {"messageID":"m1"}`.
    - `buildRevertJson("m1", "p1") == {"messageID":"m1","partID":"p1"}`.
    - Escaping: an id containing a quote/backslash is JSON-escaped (reuse the parser's `escape`).

## Phase 4 — AGENTS conformance cleanup

12. Remove the unused bundle key `revert.disabled.agentBusy` from `KiloBundle.properties` and all
    translated bundles (grep confirms it is referenced nowhere in Kotlin). Alternatively, if the
    team wants VS Code parity, wire it as a disabled-state tooltip on the Rollback button — but
    the recommended, lower-risk action is removal, since JetBrains intentionally aborts the busy
    turn instead of disabling the button.
13. Remove redundant `isOpaque = false` on the transparent `Stack`s in `RevertBanner.kt`
    (`body`, `files`) — `Stack` is already a no-color panel. Keep `isOpaque = false` on the
    `BorderLayoutPanel` root only if it visibly overlays the session surface; otherwise remove it
    too and rely on the default.
14. Add usage metrics for the new user-facing actions in `SessionController.kt`, using the
    existing `capture(event, props)` + `sessionProps(id)` helpers:
    - In `revert()` (on the success path, after `sessions.revert`): `capture("Session Rollback",
      sessionProps(id))`.
    - In `redo()`/`redoAll()`/`unrevert()`: `capture("Session Redo", sessionProps(id))` /
      `capture("Session Redo All", ...)` as appropriate. Keep names consistent with existing
      event naming; do not add PII.

## Out of scope

- Exposing `config.snapshot`/`vcs` to the frontend to proactively warn before a revert.
- Changing the retained-vs-rebuild strategy of `RevertBanner.files` (low-frequency update;
  acceptable as-is).
- Replacing the full-project `ACTION_SYNCHRONIZE` in `synchronizeFromDisk` with a scoped VFS
  refresh (only revisit if it shows up as a perf problem).
- Any VS Code webview parity changes beyond the shared i18n strings already present.

## Validation

Run from `packages/kilo-jetbrains/`:

- `./gradlew typecheck` — compiles all Kotlin including generated client.
- `./gradlew test` — runs frontend + backend suites, including the new tests. Requires Java 21;
  only check Java if Gradle reports a Java error.
- Targeted while iterating: run the touched test classes (`TurnLifecycleTest`/`RevertFlowTest`,
  `SessionMessageListPanelTest`, `SessionModelTest`, `KiloBackendChatManagerTest`,
  `KiloCliDataParserTest`).

Manual smoke (optional, `./gradlew runIde`): trigger a rollback in a non-git directory (or with
`snapshot: false`) and confirm the banner shows the "files not changed" notice with no file rows;
trigger one in a git repo and confirm the notice is hidden and file rows appear.

## Changeset

Add `.changeset/<slug>.md` (`"@kilocode/kilo-jetbrains": patch`) describing the user-facing
change, e.g. "Clarify in JetBrains rollback that only the conversation was reverted when
snapshots are disabled." Test-only and refactor tasks do not need their own changeset.

## Suggested order

Phase 3 backend tests (9–11) and model tests (5) are independent and can be done first to lock
behavior. Then Phase 1 (user-facing messaging) with its banner tests (7). Then Phase 2 refactor,
Phase 4 cleanups, controller tests (6, 8), and the changeset last.
