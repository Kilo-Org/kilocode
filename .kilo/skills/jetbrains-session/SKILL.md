---
name: jetbrains-session
description: Use when working on the JetBrains chat session UI or SessionModel/SessionController — transcript cards, retained Swing lifecycle, session background surfaces, editor-derived styling, adding session events, and session/controller testing with FakeSessionRpcApi.
---

# JetBrains Session Component

Detailed reference for the chat session feature in `packages/kilo-jetbrains/`. See `packages/kilo-jetbrains/AGENTS.md` for the component-model summary and reuse index; this skill covers the full architecture, background/lifecycle rules, and testing helpers.

## Session UI Background Strategy

The chat session UI intentionally uses a single-backdrop model. Do not make every
container paint `SessionUiStyle.Colors.sessionBackground()` just because it sits
inside the session. This avoids fragile component-hierarchy coupling and prevents
theme-specific artifacts in transparent/rounded Swing painting.

- `SessionRootPanel` is the primary opaque backdrop. It overrides `getBackground()` and returns `SessionUiStyle.Colors.sessionBackground()`.
- `sessionBackground()` follows the panel background, but when that equals the raised editor surface (`codeBlockBackground()`) — e.g. Islands Dark/Darcula, where panel and editor backgrounds are identical — it shifts by `SESSION_DELTA` via `UiStyle.Colors.contrast` (lighter in dark themes, darker in light) so the prompt bubble/input and other raised surfaces stay visible. This is a universal fallback, not a per-theme override.
- `SessionRootPanel.Blocker` is the only other session-background opaque panel. It also overrides `getBackground()` with `sessionBackground()` for modal blocking.
- Scroll panes, viewports, transcript layout panels, message lists, turn containers, wrapper panels, and card bodies should be non-opaque unless they intentionally paint a distinct surface.
- `applyStyle(style)` must not assign session-background colors. It may update fonts, foregrounds, editor colors, and other non-background styling. Background colors that must be dynamic should come from `getBackground()` or custom painting.
- Transcript card header hover is `getBackground()`-driven: keep an `isHovered` flag on the hover row/header, set or clear it from mouse enter/exit, and repaint only that row/header. Do not assign `row.background` or `header.background` on hover.
- Primary/secondary transcript card bodies are transparent by default. The actual content inside a body (code blocks, todo list, shell/tool output) is the raised surface: make that content component opaque and paint `SessionUiStyle.Colors.codeBlockBackground()` (the editor background), using its own insets so the fill covers the whole content. For `MdView`-backed bodies set `md.opaque = false` so the prose/body stays transparent while the code/output panes remain the opaque editor surface — do not make the whole body opaque.
- Rounded cards that paint their own surface (for example `RoundedContentPanel`-based question/login cards) should do that in custom painting or a `contentColor()` override, not by making every nested panel opaque.
- Standard platform buttons placed on custom-painted session cards should not force the card background. If a button sits on a rounded/custom-painted card, make it non-opaque when needed so Swing does not fill its rectangular bounds behind `DarculaButtonUI`'s rounded paint (notably visible in Islands Light).
- `DialogView` (question, permission, login-required, outcome, revert, onboarding cards) is a fourth documented surface: `contentColor()` paints `SessionUiStyle.View.Dialog.bgColor()` — a `DIALOG_DELTA` contrast shift off the backdrop — while `outlined` is true, so the card reads as its own panel, distinct from both the backdrop and `codeBlockBackground()`. Its border is `Dialog.outlineColor()`, the midpoint between backdrop and card fill, so the edge is a soft transition rather than the hard `Outline.brightColor()` line a fill-less card needs. `setOutlined(false)` drops back to the plain backdrop color with no outline, for chrome-free states like an interrupted-run note.

When adding a new session view, start with transparent containers and add opaque
painting only for components that are actual visual surfaces. If a component's
background must react to hover/theme state, prefer an override such as
`getBackground()` over writing `background = ...` during setup or `applyStyle`.

## Swing Component Lifecycle

Swing is retained-mode UI. For dynamic Swing surfaces such as session cards, transcript parts, hover rows, and collapsible panels, build a stable component tree once and then mutate existing components in response to model or interaction changes.

- Do not use a React-style `state -> render()` loop for Swing components.
- Avoid card-level `render()` methods that remove/recreate headers, text areas, markdown views, controls, or scroll panes after every click, hover, or model update.
- Give each renderer an `update(model)` method that applies model changes directly to existing UI components.
- In `update(model)`, compare before assigning when practical: label text, icons, foregrounds, fonts, body text, visibility, cursor, and containment.
- Do not duplicate state in booleans when Swing component state already answers the question.
- Derive expanded state from containment (e.g. `scroll.parent === root`) rather than maintaining an `open` boolean.
- Derive hover state from the current header background or other component property rather than maintaining a `hover` boolean.
- Expand/collapse should attach or detach the existing body component and update controls only if attachment changed.
- Expandable session cards extend `AbstractSessionPartView`, which binds click-to-toggle and hover across the whole header subtree automatically (including children added later). Do not re-bind header parts per view. A header control that must not toggle the card (file link, copy button, toolbar action) simply owns its own mouse listener and is skipped automatically.
- Hover should update only the affected component (usually the header background) and repaint only that component when the effective color changed.
- Lazy-create expensive bodies such as `JBTextArea`, `JBScrollPane`, markdown panes, and HTML panes on first expansion or first direct access.
- Keep what every transcript card carries for the whole session small. Every editor tab switch walks the entire transcript tree, so attach rarely shown header parts (the expand arrow, a file link, a copy placeholder) only while they show instead of keeping them attached and hidden.
- Parent containers should refresh for add/remove/reorder operations, not automatically after every delegated child update or streaming delta.
- Child views should call `revalidate()`/`repaint()` only when they changed preferred size, visibility, containment, or paint output.
- Empty deltas, identical text, unchanged styles, repeated hover values, and no-op toggles should not repaint the whole card.
- Private helpers named `render()` in Swing views invite full tree rebuilds. Prefer names like `syncBody()`, `syncArrow()`, `syncHtml()`, or `applyModel()`.

Tests for retained Swing components should assert:
- Collapsed components start unattached; expensive bodies are not created until first expansion.
- First expansion creates the body once; collapse detaches it; re-expansion reuses the same instance.
- `isExpanded()` agrees with actual containment.
- `update(model)` changes existing labels/body text without duplicating components.
- Updates while collapsed do not eagerly create lazy bodies.
- No-op updates, empty deltas, repeated hover values, and toggling non-expandable cards do not repaint/revalidate the whole view.
- Streaming/rebuilding surfaces additionally require stress + leak tests (see below).

## Stress and Leak Tests for Streaming UI

Session/transcript UI that streams updates or rebuilds its component tree (markdown
views, code blocks, transcript parts, collapsible cards) must ship stress + leak tests in
addition to behavior tests. These tests must:

- Drive many updates (hundreds of streamed deltas or `set` cycles) through the public API.
- Assert that retained component instances stay identical across updates (`assertSame`).
- Assert the component count stays bounded — no growth per update.
- Assert disposable-backed resources return to baseline after churn + clear/dispose.
  For code editors, compare `EditorFactory.getInstance().allEditors.size` against a
  baseline captured before the loop.

See `MdViewHybridStressTest` for the reference pattern.

## Session Component

The chat session feature uses a three-layer Model / Controller / View architecture. All files live under
`frontend/src/main/kotlin/ai/kilocode/client/session/`.

### Architecture

**`SessionModel`** (`model/SessionModel.kt`)

- Single source of truth for session content and runtime state.
- **EDT-only access** — no synchronisation. `SessionController` guarantees all reads and writes happen on the EDT.
- State is mutated only through dedicated methods (`setState`, `upsertMessage`, `setDiff`, etc.), never via direct field assignment from outside the model.
- Every mutation fires a sealed `SessionModelEvent` that carries the data needed for rendering — UI never needs to read back from the model after receiving an event.
- Each event overrides `toString()` with a compact, stable label (e.g. `"MessageAdded msg1"`, `"DiffUpdated files=2"`). Tests assert events by comparing joined `toString()` output.
- `loadHistory()` and `clear()` reset all state fields — diff, todos, compactionCount, messages, and `SessionState.Idle`. Call them when opening or clearing a session.

**`SessionController`** (`SessionController.kt`)

- Owns one `SessionModel`. UIs read from `model` and subscribe to `SessionModelEvent` via `model.addListener()`.
- Accepts an optional `id` at construction.
  - `id = null` → lazily creates a new session on the first `prompt()` call. This guarantees events are subscribed before the prompt is sent, eliminating race conditions.
  - `id != null` → immediately loads history and subscribes to SSE events on construction.
- After history load, `recoverPending()` seeds state in this priority order: (1) pending permission, (2) pending question, (3) current session status (`busy`/`retry`/`offline` from `KiloSessionService.statuses`), (4) `Idle`.
- All SSE events are filtered by `sessionID` before being handled. `session.error` events with `null` sessionID are treated as global and pass through.
- Publishes coarser lifecycle updates (app/workspace changes, view switching) via `SessionControllerEvent` to registered listeners — keep these separate from the fine-grained `SessionModelEvent` stream.

**View** (UI classes under `ui/`)

- Listens to `SessionModelEvent` via `model.addListener(parent) { event -> when(event) { ... } }`.
- The `when` block must be exhaustive — add `-> Unit` branches for events the view intentionally ignores so new events surface as compile errors.
- Views call `SessionController` actions (`prompt()`, `replyPermission()`, etc.) on the EDT; the controller dispatches RPC calls to a coroutine scope.
- Views must never access RPC or services directly — everything goes through the controller.

### Adding a New Event

1. Add a subclass to `SessionModelEvent` with a stable `toString()`.
2. Add the corresponding state field and mutation method to `SessionModel`. Reset the field in both `loadHistory()` and `clear()`.
3. Handle the new `ChatEventDto` in `SessionController.handle()` by calling the model mutation method.
4. Add `-> Unit` stubs for the new event in any existing exhaustive `when` blocks in view code.

### Editor-Dependent Session Styling

Session UI components that render text using editor fonts or colors must not read global editor settings directly on every paint. Instead they must:

1. Implement `SessionEditorStyleTarget` (`session/ui/style/SessionEditorStyle.kt`).
2. Hold a snapshot field initialised with `SessionEditorStyle.current()`.
3. Override `applyStyle(style: SessionEditorStyle)` and update all fonts/colors in one place without rebuilding Swing nodes.

`SessionUi` propagates a refreshed `SessionEditorStyle` to every registered `SessionEditorStyleTarget` child when the global editor scheme changes. New session elements that depend on editor settings must be registered through this flow, not through ad hoc `EditorColorsManager` listeners.

**Anti-patterns to avoid:**
- Do not pass `SessionEditorStyle` fields through constructors or method parameters when the component can implement the interface and receive updates via `applyStyle`.
- Do not store individual style properties (e.g. a separate `font` field copied from the style) when holding the full `SessionEditorStyle` snapshot is cleaner.

### Session Testing

Controller tests extend `SessionControllerTestBase` (`test/…/session/SessionControllerTestBase.kt`),
which provides a real IntelliJ Application and EDT via `BasePlatformTestCase`, real frontend services
wired to `FakeSessionRpcApi`, and a set of shared helpers.

**Two setups:**

| Setup | When to use |
|---|---|
| `val (m, events, modelEvents) = prompted()` | New-session flow — sets app/workspace to ready, creates a controller with no ID, sends an initial prompt. `model.showMessages` is `true`. Start all event-driven tests from here. |
| `controller("ses_test")` + manual `appRpc`/`projectRpc` setup + `flush()` | Existing-session flow — opens a specific session, triggers history load and `recoverPending()`. `model.showMessages` is `false`. Use for recovery and history tests. Pass `show = false` to `assertSession`. |

**Core assertion helpers:**

```kotlin
// Full controller state — includes model transcript + status line.
// show=true is the default; pass show=false for existing-session tests.
assertSession("""
    assistant#msg1
    text#prt1:
      hello

    [code] [kilo/gpt-5] [idle]
""", m)

// Just the model transcript (no status line)
assertModel("diff: src/A.kt src/B.kt", m)

// Model event stream — one event per line via event.toString()
assertModelEvents("""
    MessageAdded msg1
    ContentAdded msg1/prt1
""", modelEvents)

// Controller lifecycle events
assertControllerEvents("WorkspaceReady", events)
```

**Emitting events and flushing:**

```kotlin
emit(ChatEventDto.TurnOpen("ses_test"))         // emits + flushes by default
emit(ChatEventDto.PartDelta(…), flush = false)  // batch without intermediate flush
flush()                                          // settle coroutines + drain EDT
```

**`FakeSessionRpcApi` configurable state:**

| Field | Purpose |
|---|---|
| `rpc.events` (`MutableSharedFlow`) | Emit `ChatEventDto` events the controller will receive |
| `rpc.statuses` (`MutableStateFlow<Map<String, SessionStatusDto>>`) | Seed the status map read during `recoverPending()` |
| `rpc.history` | Messages returned by `messages()` (history load) |
| `rpc.pendingPermissionList` | Permissions returned during recovery |
| `rpc.pendingQuestionList` | Questions returned during recovery |
| `rpc.prompts`, `rpc.permissionReplies`, etc. | Call tracking for RPC side-effects |

**String format of `model.toString()`** (used by `assertModel` / `assertSession`):

```
role#msgId
text#partId:
  line one
  line two
---
tool#partId toolName [STATE] optional title
---
question#id
tool: msgId/callId
header: …
prompt: …
option: label - description
multiple: false
custom: true
---
diff: file1 file2
---
todo: [status] content
---
compacted: N
```

Sections are separated by `---`. Only non-empty sections appear. The status line appended by `SessionController.toString()` is:

```
[agentName] [provider/modelId] [idle|busy|retry|offline|error|awaiting-question|awaiting-permission] [optional detail]
```
