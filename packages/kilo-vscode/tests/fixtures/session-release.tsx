import assert from "node:assert/strict"
import { Window } from "happy-dom"
import type { SessionContextValue } from "../../webview-ui/src/context/session-types"
import type { ExtensionMessage, Message, SessionInfo, WebviewMessage } from "../../webview-ui/src/types/messages"

const window = new Window({ url: "http://localhost" })
Object.defineProperty(window, "origin", { value: window.location.origin })
const sent: WebviewMessage[] = []
const api = {
  postMessage: (message: WebviewMessage) => {
    sent.push(message)
  },
  getState: () => undefined,
  setState: () => {},
}

Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  localStorage: window.localStorage,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  HTMLHeadElement: window.HTMLHeadElement,
  HTMLInputElement: window.HTMLInputElement,
  HTMLTextAreaElement: window.HTMLTextAreaElement,
  SVGElement: window.SVGElement,
  MutationObserver: window.MutationObserver,
  IntersectionObserver: window.IntersectionObserver,
  ResizeObserver: window.ResizeObserver,
  CustomEvent: window.CustomEvent,
  Event: window.Event,
  MessageEvent: window.MessageEvent,
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  getComputedStyle: window.getComputedStyle.bind(window),
  acquireVsCodeApi: () => api,
})

// Static imports would run before the happy-dom globals above exist, so the
// webview modules (which read `window` at import time) must load after them.
const { render } = await import("solid-js/web")
const { VSCodeProvider } = await import("../../webview-ui/src/context/vscode")
const { ServerProvider } = await import("../../webview-ui/src/context/server")
const { ConfigContext } = await import("../../webview-ui/src/context/config")
const { LanguageContext } = await import("../../webview-ui/src/context/language")
const { NotificationsProvider } = await import("../../webview-ui/src/context/notifications")
const { ProviderProvider } = await import("../../webview-ui/src/context/provider")
const { DialogProvider } = await import("@kilocode/kilo-ui/context/dialog")
const { SessionProvider, useSession } = await import("../../webview-ui/src/context/session")
const { post } = await import("../../webview-ui/src/utils/webview-message")
const { drafts, savePromptDraft } = await import("../../webview-ui/src/utils/draft-store")
const { sessionDraftKey, scopeDraftKey } = await import("../../webview-ui/src/utils/prompt-drafts")

const config = {
  config: () => ({}),
  globalConfig: () => ({}),
  globalDraft: () => ({}),
  projectConfig: () => ({}),
  collections: () => ({}),
  settings: () => ({}),
  shortcuts: () => ({ bindings: {}, selection: false }),
  features: () => ({ indexing: false, sandboxControls: false, backgroundSubagents: false }),
  loading: () => false,
  isDirty: () => false,
  saving: () => false,
  saveError: () => null,
  updateConfig: () => {},
  updateGlobalConfig: () => {},
  updateProjectConfig: () => {},
  updateSetting: () => {},
  applySetting: () => {},
  saveConfig: () => {},
  discardConfig: () => {},
}
const language = {
  locale: () => "en",
  setLocale: () => {},
  userOverride: () => "",
  t: (key: string) => key,
}

const view = { value: undefined as SessionContextValue | undefined }
const Probe = () => {
  view.value = useSession()
  return null
}

const host = document.createElement("div")
document.body.append(host)
const dispose = render(
  () => (
    <DialogProvider>
      <VSCodeProvider>
        <ServerProvider>
          <ProviderProvider>
            <ConfigContext.Provider value={config as never}>
              <LanguageContext.Provider value={language as never}>
                <NotificationsProvider>
                  <SessionProvider>
                    <Probe />
                  </SessionProvider>
                </NotificationsProvider>
              </LanguageContext.Provider>
            </ConfigContext.Provider>
          </ProviderProvider>
        </ServerProvider>
      </VSCodeProvider>
    </DialogProvider>
  ),
  host,
)

const settle = async () => {
  await Promise.resolve()
  await window.happyDOM.waitUntilComplete()
}
const emit = async (message: ExtensionMessage) => {
  post(message)
  await settle()
}
const info = (id: string): SessionInfo => ({
  id,
  title: id,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
})
const message = (id: string, sessionID: string): Message => ({
  id,
  sessionID,
  role: "user",
  createdAt: "2026-01-01T00:00:00.000Z",
})

const failures: string[] = []
const check = async (id: string, fn: () => void | Promise<void>) => {
  try {
    await fn()
    console.log(`pass: ${id}`)
  } catch (error) {
    failures.push(`${id}: ${error instanceof Error ? error.message : String(error)}`)
  }
}
const session = () => {
  const value = view.value
  assert(value, "Probe did not run")
  return value
}
const lastOf = <T extends WebviewMessage["type"]>(type: T) => {
  const matches = sent.filter((item) => item.type === type)
  return matches.at(-1) as Extract<WebviewMessage, { type: T }> | undefined
}

try {
  await settle()
  await emit({ type: "ready", serverInfo: { port: 1 } })
  await emit({ type: "sessionsLoaded", sessions: [info("child"), info("other")] })
  await emit({ type: "messagesLoaded", sessionID: "child", messages: [message("child-1", "child")] })
  const draftKey = sessionDraftKey("child")!
  const boxKey = scopeDraftKey("chat", draftKey)
  savePromptDraft(draftKey, "draft text", [], [])
  savePromptDraft(boxKey, "draft text", [], [])
  // Select the session and give it a non-idle status first, so the assertion
  // below fails if release clears the released session's status.
  session().selectSession("child")
  await emit({ type: "sessionStatus", sessionID: "child", status: "busy" })
  // Todos are session state, not transcript state: only a live `todoUpdated`
  // fills them, so an idle or finished child never restores a dropped list.
  await emit({ type: "todoUpdated", sessionID: "child", items: [{ content: "ship the fix", status: "in_progress" }] })
  await check("todo-seeded", () => {
    assert.deepEqual(
      session()
        .todos()
        .map((item) => item.content),
      ["ship the fix"],
      "the selected session should hold the todo list it was given",
    )
  })

  session().releaseSession("child")
  await settle()

  await check("release-drops-transcript", () => {
    assert.deepEqual(session().allMessages()["child"] ?? [], [], "cached transcript should be dropped")
  })
  await check("release-preserves-todos", () => {
    assert.deepEqual(
      session()
        .todos()
        .map((item) => item.content),
      ["ship the fix"],
      "release must keep the session's todo list",
    )
  })
  await check("release-keeps-draft", () => {
    assert.equal(drafts.get(draftKey), "draft text", "session draft should survive release")
    assert.equal(drafts.get(boxKey), "draft text", "box-scoped session draft should survive release")
  })
  await check("release-keeps-session", () => {
    assert(
      session()
        .sessions()
        .some((item) => item.id === "child"),
      "released session should stay listed",
    )
  })
  await check("release-keeps-status", () => {
    assert.equal(session().isSubmitting("child"), false, "release should not start a submission")
    assert.equal(session().currentSessionID(), "child", "release should not change the current session")
    assert.equal(session().status(), "busy", "release should keep the released session's status")
  })
  await check("release-refetches-on-select", () => {
    const before = sent.length
    session().selectSession("child")
    const load = sent.slice(before).find((item) => item.type === "loadMessages" && item.sessionID === "child") as
      | Extract<WebviewMessage, { type: "loadMessages" }>
      | undefined
    assert(load, "selecting the released session should request its transcript")
    assert.equal(load.mode, "replace", "the released marker should make the fetch a full replace")
  })
  // A reopened child answers with a plain snapshot: the backend only puts a
  // `todowrite` part in the transcript when the child wrote one, so a finished
  // child's checklist is gone unless the release kept it.
  await emit({
    type: "messagesLoaded",
    sessionID: "child",
    mode: "replace",
    messages: [message("child-1", "child")],
  })
  await check("reselect-keeps-todos", () => {
    assert.deepEqual(
      session()
        .todos()
        .map((item) => item.content),
      ["ship the fix"],
      "a replace snapshot without a todo part must not clear the kept todo list",
    )
  })
  await check("release-clears-loading", () => {
    // The first release drops the loaded marker, so the next selection is a
    // cold one and latches its loading state.
    session().releaseSession("child")
    session().selectSession("child")
    assert.equal(session().loading(), true, "selecting a released session should latch its load")
    const before = sent.length
    session().releaseSession("child")
    assert.equal(session().loading(), false, "releasing the current session must clear its latched loading state")
    assert.equal(sent.length, before, "release must not post a request")
  })
  await emit({ type: "messagesLoaded", sessionID: "child", messages: [message("child-1", "child")] })
  await check("release-holds-snapshot-out", () => {
    // The load signal cannot turn on here, so assert the gate's own effect: the
    // held-out snapshot must not rebuild the transcript the release dropped.
    assert.deepEqual(
      session().allMessages()["child"] ?? [],
      [],
      "a held-out snapshot must not rebuild the dropped transcript",
    )
    assert.equal(session().loading(), false, "a held-out snapshot must leave the loading state alone")
  })
  await check("release-select-loads-again", () => {
    const before = sent.length
    session().selectSession("child")
    const load = sent.slice(before).find((item) => item.type === "loadMessages" && item.sessionID === "child") as
      | Extract<WebviewMessage, { type: "loadMessages" }>
      | undefined
    assert(load, "selecting the released session should request its transcript again")
    assert.equal(load.mode, "replace", "the second release should make the fetch a full replace again")
    assert.equal(session().loading(), true, "selecting the released session should show loading again")
  })

  await emit({ type: "sessionStatus", sessionID: "child", status: "busy" })
  await check("release-keeps-events-status", () => {
    assert.equal(session().activityFor("child"), "busy", "released session should still receive status events")
  })
  await emit({
    type: "permissionRequest",
    permission: { id: "perm-later", sessionID: "child", toolName: "bash", patterns: [], always: [], args: {} },
  })
  await check("release-keeps-events-permission", () => {
    assert(
      session()
        .permissions()
        .some((item) => item.id === "perm-later"),
      "released session should still receive permission requests",
    )
  })
  await emit({
    type: "questionRequest",
    question: { id: "q-later", sessionID: "child", questions: [] },
  })
  await check("release-keeps-events-question", () => {
    assert(
      session()
        .questions()
        .some((item) => item.id === "q-later"),
      "released session should still receive question requests",
    )
  })
  await emit({
    type: "suggestionRequest",
    suggestion: { id: "s-later", sessionID: "child", text: "next", actions: [] },
  })
  await check("release-keeps-events-suggestion", () => {
    assert(
      session()
        .suggestions()
        .some((item) => item.id === "s-later"),
      "released session should still receive suggestions",
    )
  })

  await emit({ type: "sessionDeleted", sessionID: "child" })
  await emit({ type: "sessionsLoaded", sessions: [info("child"), info("other")] })
  await emit({
    type: "permissionRequest",
    permission: { id: "perm-relist", sessionID: "child", toolName: "bash", patterns: [], always: [], args: {} },
  })
  await check("relist-visible", () => {
    assert(
      session()
        .permissions()
        .some((item) => item.id === "perm-relist"),
      "a re-listed session should receive its permission requests",
    )
  })
  await check("relist-listed", () => {
    assert(
      session()
        .sessions()
        .some((item) => item.id === "child"),
      "a re-listed session should appear again",
    )
  })
  // The delete path, unlike the release path, must forget the todo list: a
  // re-listed session is a new one and must not show the deleted child's
  // checklist.
  session().selectSession("child")
  await settle()
  await check("delete-clears-todos", () => {
    assert.deepEqual(session().todos(), [], "a deleted session must not keep its todo list")
  })

  await emit({ type: "questionRequest", question: { id: "q-live", sessionID: "child", questions: [] } })
  await emit({
    type: "suggestionRequest",
    suggestion: { id: "s-live", sessionID: "child", text: "next", actions: [] },
  })
  session().selectSession("other")
  await settle()

  await check("reply-attribution", () => {
    const posted = session().replyToQuestion("q-live", [["a"]])
    assert.equal(posted, true, "a live question should report that the reply was posted")
    const reply = lastOf("questionReply")
    assert.equal(reply?.requestID, "q-live", "reply should be posted for the live question")
    assert.equal(reply?.sessionID, "child", "reply should carry the request's own session")
  })
  await check("reject-attribution", () => {
    const posted = session().rejectQuestion("q-live")
    assert.equal(posted, true, "a live question should report that the reject was posted")
    const reject = lastOf("questionReject")
    assert.equal(reject?.requestID, "q-live", "reject should be posted for the live question")
    assert.equal(reject?.sessionID, "child", "reject should carry the request's own session")
  })
  await check("accept-attribution", () => {
    session().acceptSuggestion("s-live", 1)
    const accept = lastOf("suggestionAccept")
    assert.equal(accept?.requestID, "s-live", "accept should be posted for the live suggestion")
    assert.equal(accept?.sessionID, "child", "accept should carry the request's own session")
    assert.equal(accept?.index, 1, "accept should keep the chosen index")
  })
  await check("dismiss-attribution", () => {
    session().dismissSuggestion("s-live")
    const dismiss = lastOf("suggestionDismiss")
    assert.equal(dismiss?.requestID, "s-live", "dismiss should be posted for the live suggestion")
    assert.equal(dismiss?.sessionID, "child", "dismiss should carry the request's own session")
  })

  await emit({ type: "questionResolved", requestID: "q-live" })
  await check("stale-question-posts-nothing", () => {
    const before = sent.length
    const replied = session().replyToQuestion("q-live", [["a"]])
    const rejected = session().rejectQuestion("q-live")
    assert.equal(replied, false, "a resolved question should report that nothing was posted")
    assert.equal(rejected, false, "a resolved question should report that nothing was rejected")
    assert.equal(sent.length, before, "a resolved question must not post a reply or reject")
  })
  await emit({ type: "suggestionResolved", requestID: "s-live" })
  await check("stale-suggestion-posts-nothing", () => {
    const before = sent.length
    session().acceptSuggestion("s-live", 0)
    session().dismissSuggestion("s-live")
    assert.equal(sent.length, before, "a resolved suggestion must not post accept or dismiss")
  })
  await check("stale-suggestion-no-responding", () => {
    assert.equal(
      session().respondingSuggestions().has("s-live"),
      false,
      "a resolved suggestion must not latch a responding flag",
    )
  })

  await check("unknown-permission-returns-false", () => {
    assert.equal(session().respondToPermission("missing", "once", [], []), false, "unknown permission should fail")
  })
  await check("unknown-permission-posts-nothing", () => {
    const before = sent.length
    session().respondToPermission("missing-again", "once", [], [])
    assert.equal(sent.length, before, "an unknown permission must not post a response")
  })

  // A released session keeps streaming. Its transcript events must not rebuild
  // the cache release just dropped, or a reopened panel would show a partial
  // transcript until the full fetch lands.
  session().releaseSession("other")
  await settle()
  const later = message("other-1", "other")
  await emit({
    type: "messageCreated",
    message: { ...later, role: "assistant", time: { created: 1, completed: 2 }, finish: "stop" },
  })
  await emit({
    type: "partUpdated",
    sessionID: "other",
    messageID: "other-1",
    part: { id: "other-1-p", sessionID: "other", messageID: "other-1", type: "text", text: "still working" },
  })
  await emit({
    type: "partUpdated",
    sessionID: "other",
    messageID: "other-1",
    part: {
      id: "other-1-tool",
      sessionID: "other",
      messageID: "other-1",
      type: "tool",
      tool: "bash",
      callID: "call-other-1",
      state: { status: "running", input: { command: "ls" } },
    },
  })
  await emit({ type: "todoUpdated", sessionID: "other", items: [{ id: "t1", content: "step", status: "pending" }] })
  await check("release-blocks-transcript-refill", () => {
    assert.deepEqual(
      session().allMessages()["other"] ?? [],
      [],
      "a released session's transcript events must not refill the dropped cache",
    )
    assert.deepEqual(session().getParts("other-1"), [], "a released session must not regain message parts")
    assert.deepEqual(session().getSessionToolParts("other"), [], "a released session must not regain tool parts")
  })
  await check("release-keeps-todos", () => {
    assert.deepEqual(
      session()
        .todos()
        .map((item) => item.id),
      ["t1"],
      "a released session must still receive its todo updates",
    )
  })
  await emit({
    type: "questionRequest",
    question: { id: "q-after-release", sessionID: "other", questions: [] },
  })
  await check("release-keeps-prompts-after-transcript-drop", () => {
    assert(
      session()
        .questions()
        .some((item) => item.id === "q-after-release"),
      "a released session must still receive its question requests",
    )
  })
  await emit({ type: "questionResolved", requestID: "q-after-release" })
  await emit({ type: "sessionStatus", sessionID: "other", status: "busy" })
  await check("release-keeps-status-events-after-transcript-drop", () => {
    assert.equal(session().activityFor("other"), "busy", "a released session must still receive status events")
  })
  session().selectSession("other")
  await settle()
  const resumed = message("other-2", "other")
  await emit({
    type: "messageCreated",
    message: { ...resumed, role: "assistant", time: { created: 3, completed: 4 }, finish: "stop" },
  })
  await check("select-restores-transcript-events", () => {
    assert(
      (session().allMessages()["other"] ?? []).some((item) => item.id === "other-2"),
      "selecting a released session must accept its transcript events again",
    )
  })
  session().releaseSession("other")
  await settle()
  await emit({ type: "messagesLoaded", sessionID: "other", messages: [message("other-3", "other")] })
  await check("release-holds-unrequested-snapshot", () => {
    assert.deepEqual(
      session().allMessages()["other"] ?? [],
      [],
      "a snapshot for a released session must wait until the session is selected",
    )
  })
  session().selectSession("other")
  await settle()
  await emit({ type: "messagesLoaded", sessionID: "other", messages: [message("other-3", "other")] })
  const afterLoad = message("other-4", "other")
  await emit({
    type: "messageCreated",
    message: { ...afterLoad, role: "assistant", time: { created: 5, completed: 6 }, finish: "stop" },
  })
  await check("transcript-load-restores-transcript-events", () => {
    const ids = (session().allMessages()["other"] ?? []).map((item) => item.id)
    assert(ids.includes("other-3"), "a transcript load must populate a selected session")
    assert(ids.includes("other-4"), "a transcript load must accept later transcript events again")
  })
} finally {
  dispose()
  await window.happyDOM.cancelAsync()
  await window.happyDOM.close()
}

assert.deepEqual(failures, [], failures.join("\n"))
