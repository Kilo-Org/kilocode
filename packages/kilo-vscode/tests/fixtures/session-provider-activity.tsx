import assert from "node:assert/strict"
import { Window } from "happy-dom"

const window = new Window({ url: "http://localhost" })
Object.defineProperty(window, "origin", { value: window.location.origin })
const sent: unknown[] = []
const api = {
  postMessage: (message: unknown) => sent.push(message),
  getState: () => undefined,
  setState: () => {},
}

Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
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

const { render } = await import("solid-js/web")
const { For } = await import("solid-js")
const { DragDropProvider, SortableProvider } = await import("@thisbeyond/solid-dnd")
const { renderTab } = await import("../../webview-ui/agent-manager/tab-rendering")
const { VSCodeProvider } = await import("../../webview-ui/src/context/vscode")
const { ServerProvider } = await import("../../webview-ui/src/context/server")
const { ConfigContext } = await import("../../webview-ui/src/context/config")
const { LanguageContext } = await import("../../webview-ui/src/context/language")
const { ProviderContext } = await import("../../webview-ui/src/context/provider")
const { SessionProvider, useSession } = await import("../../webview-ui/src/context/session")
const { post } = await import("../../webview-ui/src/utils/webview-message")

const provider = {
  providers: () => ({}),
  connected: () => [],
  defaults: () => ({}),
  defaultSelection: () => ({ providerID: "kilocode", modelID: "auto" }),
  models: () => [],
  findModel: () => undefined,
  authMethods: () => ({}),
  authStates: () => ({}),
  isModelValid: () => true,
}
const config = {
  config: () => ({}),
  globalConfig: () => ({}),
  globalDraft: () => ({}),
  projectConfig: () => ({}),
  collections: () => ({}),
  settings: () => ({}),
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

const ref = { value: undefined as ReturnType<typeof useSession> | undefined }
const Probe = () => {
  const session = useSession()
  ref.value = session
  const ids = ["root", "background"]
  const deps = {
    terms: { activeId: () => undefined },
    REVIEW_TAB_ID: "review",
    tabIds: () => ids,
    kb: () => ({}),
    reviewActive: () => false,
    currentSessionID: session.currentSessionID,
    visibleTabId: session.currentSessionID,
    activePendingId: () => undefined,
    isPending: () => false,
    activityFor: session.activityFor,
    stateLabel: (state: string) => state,
    tabLookup: () => new Map(ids.map((id) => [id, { id, title: id }])),
    adjacentHint: () => "",
  } as Parameters<typeof renderTab>[1]
  return (
    <DragDropProvider>
      <SortableProvider ids={ids}>
        <For each={ids}>{(id) => renderTab(id, deps)}</For>
      </SortableProvider>
    </DragDropProvider>
  )
}
const host = document.createElement("div")
document.body.append(host)
const step = { value: 0 }
const failures: string[] = []

const dispose = render(
  () => (
    <VSCodeProvider>
      <ServerProvider>
        <ProviderContext.Provider value={provider as never}>
          <ConfigContext.Provider value={config as never}>
            <LanguageContext.Provider value={language as never}>
              <SessionProvider>
                <Probe />
              </SessionProvider>
            </LanguageContext.Provider>
          </ConfigContext.Provider>
        </ProviderContext.Provider>
      </ServerProvider>
    </VSCodeProvider>
  ),
  host,
)

const settle = async () => {
  await Promise.resolve()
  await window.happyDOM.waitUntilComplete()
}
const emit = async (data: unknown) => {
  post(data)
  await settle()
}
const state = (id: string) => {
  const value = ref.value
  assert(value)
  return value.activityFor(id)
}
const check = async (id: string, expected: string) => {
  await settle()
  step.value += 1
  const value = ref.value
  assert(value)
  const actual = state(id)
  const tab = host.querySelector(`[data-tab-id="${id}"] [data-activity]`)
  if (id === "root" || id === "background") assert(tab, `Missing rendered tab for ${id}`)
  if (tab && tab.getAttribute("data-activity") !== expected) {
    failures.push(
      `step ${step.value} ${id}: rendered tab expected ${expected}, got ${tab.getAttribute("data-activity")}`,
    )
  }
  if (actual !== expected) {
    failures.push(
      `step ${step.value} ${id}: expected ${expected}, got ${actual}, status=${value.status()}, close=${value.closeReason() ?? "none"}`,
    )
  }
}
const info = (id: string, parentID?: string) => ({
  id,
  ...(parentID ? { parentID } : {}),
  title: id,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
})
const task = (id: string, parentID: string, childID: string, nested: boolean) => ({
  type: "partUpdated",
  sessionID: parentID,
  messageID: `${parentID}-part-message`,
  part: {
    type: "tool",
    id,
    sessionID: parentID,
    messageID: `${parentID}-part-message`,
    tool: "task",
    state: { status: "running", input: {}, ...(nested ? { metadata: { sessionId: childID } } : {}) },
    ...(!nested ? { metadata: { sessionId: childID } } : {}),
  },
})

try {
  await settle()
  await emit({ type: "ready", serverInfo: { port: 1 } })
  await emit({
    type: "sessionsLoaded",
    sessions: [info("root"), info("background"), info("durable-child", "root"), info("durable-grand", "durable-child")],
  })

  const value = ref.value
  assert(value)
  value.setCurrentSessionID("root")
  await check("root", "idle")
  await check("background", "idle")

  await emit({ type: "sessionStatus", sessionID: "background", status: "busy" })
  await check("background", "busy")
  await check("root", "idle")
  await emit({ type: "sessionStatus", sessionID: "background", status: "idle" })

  await emit(task("root-task", "root", "task-child", false))
  await emit(task("child-task", "task-child", "task-grand", true))
  await emit({ type: "sessionStatus", sessionID: "durable-grand", status: "busy" })
  await check("root", "busy")
  await check("durable-child", "busy")
  await check("durable-grand", "busy")
  await emit({ type: "sessionStatus", sessionID: "durable-grand", status: "idle" })

  await emit({ type: "sessionStatus", sessionID: "task-child", status: "busy" })
  await check("root", "busy")
  await check("task-child", "busy")
  await emit({ type: "sessionStatus", sessionID: "task-child", status: "retry", attempt: 1, message: "retry", next: 1 })
  await check("root", "retry")
  await check("task-child", "retry")
  await emit({ type: "sessionStatus", sessionID: "task-child", status: "idle" })
  await emit({ type: "sessionStatus", sessionID: "task-grand", status: "busy" })
  await check("root", "busy")
  await check("task-child", "busy")
  await check("task-grand", "busy")
  await emit({ type: "sessionStatus", sessionID: "task-grand", status: "offline" })
  await check("root", "error")
  await check("task-child", "error")
  await check("task-grand", "error")
  assert.equal(value.inUseFor("root"), true)
  await emit({ type: "sessionStatus", sessionID: "task-grand", status: "idle" })
  await check("root", "idle")
  assert.equal(value.inUseFor("root"), false)

  await emit({
    type: "permissionRequest",
    permission: { id: "permission", sessionID: "task-grand", toolName: "bash", patterns: [], always: [], args: {} },
  })
  await check("root", "waiting")
  await check("task-child", "waiting")
  await check("task-grand", "waiting")
  await emit({ type: "permissionError", permissionID: "permission", stale: true })
  await check("root", "idle")
  assert.equal(value.permissions().length, 0)
  await emit({
    type: "permissionRequest",
    permission: { id: "permission", sessionID: "durable-grand", toolName: "bash", patterns: [], always: [], args: {} },
  })
  await check("root", "waiting")
  await emit({ type: "permissionResolved", permissionID: "permission", sessionID: "durable-grand", response: "once" })
  await check("root", "idle")
  assert.equal(value.permissions().length, 0)

  await emit({ type: "sessionStatus", sessionID: "task-child", status: "busy" })
  await emit({
    type: "questionRequest",
    question: { id: "notice", sessionID: "task-child", blocking: false, questions: [] },
  })
  await check("root", "busy")
  await check("task-child", "busy")
  await emit({ type: "sessionStatus", sessionID: "task-child", status: "idle" })
  await check("root", "idle")
  assert.equal(value.inUseFor("root"), true)
  assert.equal(value.inUseFor("background"), false)
  await emit({ type: "sessionStatus", sessionID: "task-child", status: "busy" })
  await emit({
    type: "questionRequest",
    question: { id: "notice", sessionID: "task-child", blocking: true, questions: [] },
  })
  await check("root", "waiting")
  await emit({ type: "questionResolved", requestID: "notice" })
  await check("root", "busy")
  await emit({ type: "sessionStatus", sessionID: "task-child", status: "idle" })

  await emit({
    type: "questionRequest",
    question: {
      id: "question",
      sessionID: "task-child",
      questions: [{ question: "Continue?", header: "Confirm", options: [] }],
    },
  })
  await check("root", "waiting")
  await emit({ type: "questionResolved", requestID: "question" })
  await check("root", "idle")
  assert.equal(value.questions().length, 0)

  await emit({
    type: "suggestionRequest",
    suggestion: { id: "suggestion", sessionID: "task-grand", text: "Try this", actions: [] },
  })
  await check("root", "waiting")
  await emit({ type: "suggestionResolved", requestID: "suggestion" })
  await check("root", "idle")
  assert.equal(value.suggestions().length, 0)

  await emit({ type: "sessionTurnClosed", sessionID: "task-child", reason: "completed", parentID: "root" })
  await check("task-child", "done")
  await check("root", "idle")
  await emit({ type: "sessionTurnClosed", sessionID: "task-child", reason: "error", parentID: "root" })
  await check("task-child", "error")
  await check("root", "idle")
  await emit({ type: "sessionStatus", sessionID: "root", status: "busy" })
  await check("root", "busy")
  await emit({ type: "sessionStatus", sessionID: "root", status: "idle" })
  await check("root", "idle")

  await emit({ type: "sessionTurnClosed", sessionID: "root", reason: "completed" })
  await check("root", "done")
  await emit({ type: "sessionStatus", sessionID: "root", status: "busy" })
  await check("root", "busy")
  await emit({ type: "sessionStatus", sessionID: "root", status: "idle" })
  await check("root", "idle")

  await emit({ type: "sessionTurnClosed", sessionID: "root", reason: "completed" })
  await check("root", "done")
  await emit({
    type: "sessionUpdated",
    session: { ...info("root"), revert: { messageID: "root-message" } },
  })
  await check("root", "idle")
  await emit({ type: "sessionUpdated", session: { ...info("root"), revert: null } })
  await check("root", "idle")

  await emit({ type: "sessionTurnClosed", sessionID: "root", reason: "completed" })
  await check("root", "done")
  value.sendMessage("next turn")
  await settle()
  await check("root", "busy")
  await emit({ type: "sessionStatus", sessionID: "root", status: "busy" })
  await check("root", "busy")
  await emit({ type: "sessionStatus", sessionID: "root", status: "idle" })
  await check("root", "idle")

  value.setCurrentSessionID("background")
  await emit({ type: "sessionStatus", sessionID: "background", status: "busy" })
  await check("background", "busy")
  await emit({ type: "sessionError", eventID: "background-aborted", error: { name: "MessageAbortedError" } })
  await check("background", "busy")
  await emit({ type: "connectionState", state: "disconnected", error: "offline" })
  await check("background", "error")
  await emit({ type: "connectionState", state: "connecting" })
  await check("background", "error")
  await emit({ type: "connectionState", state: "connected" })
  await check("background", "busy")

  await emit({
    type: "questionRequest",
    question: {
      id: "connection-question",
      sessionID: "background",
      questions: [{ question: "Reconnect?", header: "Confirm", options: [] }],
    },
  })
  await check("background", "waiting")
  await emit({ type: "connectionState", state: "error", error: "failed" })
  await check("background", "error")
  await emit({ type: "connectionState", state: "connecting" })
  await check("background", "error")
  await emit({ type: "connectionState", state: "connected" })
  await check("background", "waiting")
  await emit({ type: "questionResolved", requestID: "connection-question" })
  await check("background", "busy")
  await emit({ type: "sessionStatus", sessionID: "background", status: "idle" })
  await check("background", "idle")

  value.setCurrentSessionID("root")
  await emit({ type: "sessionError", eventID: "aborted", error: { name: "MessageAbortedError" } })
  await check("root", "idle")
  await emit({ type: "sessionError", eventID: "root-error", error: { name: "ProviderError" } })
  await check("root", "error")
  assert.equal(value.inUseFor("root"), false)
  await emit({ type: "sessionTurnClosed", sessionID: "root", reason: "completed" })
  await check("root", "error")

  await emit({ type: "sessionStatus", sessionID: "root", status: "busy" })
  await check("root", "busy")
  await emit({ type: "sessionStatus", sessionID: "root", status: "idle" })
  await check("root", "idle")

  await emit({
    type: "questionRequest",
    question: {
      id: "deleted-question",
      sessionID: "root",
      questions: [{ question: "Delete?", header: "Confirm", options: [] }],
    },
  })
  await check("root", "waiting")
  await emit({ type: "sessionDeleted", sessionID: "root" })
  await check("root", "idle")
  assert.equal(value.currentSessionID(), undefined)
  assert.equal(
    value.sessions().some((item) => item.id === "root"),
    false,
  )
  assert.equal(
    value.questions().some((item) => item.sessionID === "root"),
    false,
  )
  assert.equal(
    sent.some((item) => (item as { type?: string }).type === "sendMessage"),
    true,
  )
  assert.deepEqual(failures, [])
} finally {
  const before = state("background")
  dispose()
  post({ type: "sessionStatus", sessionID: "background", status: "retry" })
  assert.equal(state("background"), before)
  await window.happyDOM.cancelAsync()
  await window.happyDOM.close()
}

process.exit(0)
