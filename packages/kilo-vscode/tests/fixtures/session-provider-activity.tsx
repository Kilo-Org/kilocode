import assert from "node:assert/strict"
import { Window } from "happy-dom"
import type { ModelSelection, WebviewMessage } from "../../webview-ui/src/types/messages"

const window = new Window({ url: "http://localhost" })
Object.defineProperty(window, "origin", { value: window.location.origin })
const focused = { value: true }
Object.defineProperty(window.document, "hasFocus", { value: () => focused.value })
const sent: WebviewMessage[] = []
const api = {
  postMessage: (message: WebviewMessage) => {
    sent.push(message)
    if (message.type === "acknowledgeSession") {
      queueMicrotask(() => post({ ...message, type: "sessionAcknowledged" }))
    }
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
  IntersectionObserver: window.IntersectionObserver,
  CustomEvent: window.CustomEvent,
  customElements: window.customElements,
  Event: window.Event,
  MessageEvent: window.MessageEvent,
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  getComputedStyle: window.getComputedStyle.bind(window),
  acquireVsCodeApi: () => api,
})

const { render } = await import("solid-js/web")
const { For, Show, createEffect, createSignal } = await import("solid-js")
const { unwrap } = await import("solid-js/store")
const { WorktreeItem } = await import("../../webview-ui/agent-manager/WorktreeItem")
const { SubagentPanel } = await import("../../webview-ui/agent-manager/SubagentPanel")
const { DragDropProvider, SortableProvider } = await import("@thisbeyond/solid-dnd")
const { renderTab } = await import("../../webview-ui/agent-manager/tab-rendering")
const { VSCodeProvider } = await import("../../webview-ui/src/context/vscode")
const { ServerProvider } = await import("../../webview-ui/src/context/server")
const { ConfigContext } = await import("../../webview-ui/src/context/config")
const { LanguageContext } = await import("../../webview-ui/src/context/language")
const { NotificationsProvider } = await import("../../webview-ui/src/context/notifications")
const { ProviderProvider } = await import("../../webview-ui/src/context/provider")
const { SessionProvider, useSession, useSessionVisibility } = await import("../../webview-ui/src/context/session")
const { initialMessage } = await import("../../webview-ui/agent-manager/initial-message")
const { post } = await import("../../webview-ui/src/utils/webview-message")
const { terminal } = await import("../../webview-ui/src/context/session-outcome")
const { PromptInput } = await import("../../webview-ui/src/components/chat/PromptInput")
const { IndexingProvider } = await import("../../webview-ui/src/context/indexing")
const { MemoryProvider } = await import("../../webview-ui/src/context/memory")
const { SpeechToTextModelsProvider } = await import("../../webview-ui/src/context/speech-to-text-models")
const { drafts, imageDrafts, savePromptDraft } = await import("../../webview-ui/src/utils/draft-store")

const [settings, setSettings] = createSignal<{
  model?: string
  agent?: Record<string, { model?: string; variant?: string }>
}>({})
const config = {
  config: settings,
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
const observed: (ModelSelection | null)[] = []
const [operation, setOperation] = createSignal(false)
const [run, setRun] = createSignal(false)
const [inspected, setInspected] = createSignal(["task-child", "task-grand"])
const [inspector, setInspector] = createSignal(false)
const [composer, setComposer] = createSignal(false)
const [active, setActive] = createSignal("task-child")
const [review, setReview] = createSignal(false)
const [sharing, setSharing] = createSignal(false)
const peer = { value: undefined as ReturnType<typeof useSession> | undefined }
const Peer = () => {
  peer.value = useSession()
  return null
}
const Probe = () => {
  const session = useSession()
  useSessionVisibility(() => (review() ? undefined : session.currentSessionID()))
  ref.value = session
  createEffect(() => observed.push(session.selected()))
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
      <Show when={sharing()}>
        <SessionProvider>
          <Peer />
        </SessionProvider>
      </Show>
      <SortableProvider ids={ids}>
        <For each={ids}>{(id) => renderTab(id, deps)}</For>
      </SortableProvider>
      <WorktreeItem
        worktree={{
          id: "worktree",
          path: "/test/worktree",
          branch: "test",
          parentBranch: "main",
          createdAt: "2026-01-01T00:00:00.000Z",
        }}
        label="Recovery test"
        active
        pendingDelete={false}
        busy={operation()}
        activity={session.activityFor("root")}
        runStatus={run() ? { worktreeId: "worktree", state: "running" } : undefined}
        stale={false}
        sessions={1}
        grouped={false}
        groupStart={false}
        groupEnd={false}
        groupSize={0}
        renaming={false}
        renameValue=""
        closeKeybind=""
        openKeybind=""
        onClick={() => {}}
        onDelete={() => {}}
        onStartRename={() => {}}
        onRenameInput={() => {}}
        onCommitRename={() => {}}
        onCancelRename={() => {}}
        onRemoveStale={() => {}}
        onCopyPath={() => {}}
        onOpen={() => {}}
      />
      <Show when={inspector()}>
        <SubagentPanel
          tabs={() => inspected().map((id) => ({ id, title: id }))}
          active={active}
          visible={() => inspector() && inspected().length > 0}
          nextKeybind=""
          closeKeybind=""
          onSelect={setActive}
          onClose={() => {}}
          onCloseOthers={() => {}}
          onReorder={() => {}}
          onClosePanel={() => setInspector(false)}
        />
      </Show>
      <Show when={composer()}>
        <IndexingProvider>
          <MemoryProvider>
            <SpeechToTextModelsProvider>
              <PromptInput boxId="acceptance" />
            </SpeechToTextModelsProvider>
          </MemoryProvider>
        </IndexingProvider>
      </Show>
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
  ),
  host,
)

const settle = async () => {
  await Promise.resolve()
  await window.happyDOM.waitUntilComplete()
}
const focus = async (value: boolean) => {
  focused.value = value
  window.dispatchEvent(new window.Event(value ? "focus" : "blur"))
  await settle()
  assert.deepEqual(
    sent.findLast((message) => message.type === "webviewFocusChanged"),
    {
      type: "webviewFocusChanged",
      focused: value,
    },
  )
}
const emit = async (data: { type: string; [key: string]: unknown }) => {
  post(structuredClone(data.type === "sessionTurnClosed" ? { eventID: crypto.randomUUID(), ...data } : data))
  await settle()
}
const state = (id: string) => {
  const value = ref.value
  assert(value)
  return value.activityFor(id)
}
const card = (expected: string) => {
  const icon = host.querySelector('[data-sidebar-id="worktree"] .am-wt-icon')
  assert(icon)
  assert.equal(icon.getAttribute("data-activity"), expected)
  assert.equal(!!icon.querySelector('[data-component="spinner"]'), expected === "busy" || expected === "retry")
}
const check = async (id: string, expected: string) => {
  await settle()
  step.value += 1
  const value = ref.value
  assert(value)
  const actual = state(id)
  if (id === "root") card(expected)
  const tab = host.querySelector(`[data-tab-id="${id}"] [data-activity]`)
  if (id === "root" || id === "background" || (inspector() && (id === "task-child" || id === "task-grand"))) {
    assert(tab, `Missing rendered tab for ${id}`)
    assert.equal(!!tab.querySelector('[data-component="spinner"]'), expected === "busy" || expected === "retry")
  }
  if (tab && (id === "task-child" || id === "task-grand")) {
    assert.equal(tab.querySelector(".am-tab-icon")?.getAttribute("data-activity"), expected)
    assert.equal(!!tab.querySelector(".am-tab-icon")?.getAttribute("aria-label"), expected !== "idle")
    assert.equal(
      tab.querySelector('[role="tab"]')?.getAttribute("aria-label"),
      expected === "idle" ? id : `${id}: session.activity.${expected}`,
    )
  }
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
  const auto = { providerID: "kilo", modelID: "kilo-auto/free" }
  const personal = { providerID: "kilo", modelID: "personal" }
  const first = { providerID: "kilo", modelID: "z-first" }
  const recommended = { providerID: "kilo", modelID: "a-recommended" }
  const external = { providerID: "openai", modelID: "external" }
  const choice = (actual: ModelSelection | null, expected: ModelSelection) => {
    assert.equal(actual?.providerID, expected.providerID)
    assert.equal(actual?.modelID, expected.modelID)
  }
  const writes = () => sent.filter((item) => item.type === "persistModelSelection" || item.type === "persistRecents")
  const requests = () =>
    sent.filter((item) => ["sendMessage", "sendCommand", "importAndSend", "compact"].includes(item.type))
  const catalog = async (organizationId: string | null, ids: string[], model?: string, ready = true) => {
    await emit({
      type: "providersLoaded",
      organizationId,
      ready,
      providers: {
        kilo: {
          id: "kilo",
          name: "Kilo",
          models: Object.fromEntries(ids.map((id) => [id, { id, name: id, variants: { low: {}, high: {} } }])),
        },
        openai: { id: "openai", name: "OpenAI", models: { external: { id: "external", name: "External" } } },
      },
      connected: ["kilo", "openai"],
      defaults: model ? { kilo: model } : {},
      defaultSelection: auto,
      authMethods: {},
      authStates: {},
    })
  }

  assert.equal(value.selected(), null)
  value.sendMessage("initial pending")
  assert.equal(requests().length, 0)

  for (const variant of ["high", "", undefined]) {
    const id = `initial-${variant ?? "default"}`
    const request = initialMessage({
      type: "agentManager.sendInitialMessage",
      projectId: "background-project",
      sessionId: id,
      text: "Initial worktree prompt",
      providerID: "unloaded",
      modelID: "unloaded",
      agent: variant === undefined ? undefined : "ask",
      variant,
      files: [{ mime: "image/png", url: "data:image/png;base64,cHJvbXB0", filename: "prompt.png" }],
      browserFeedback: { version: 1, references: [{ id: "element", sessionId: id, selector: "button" }] },
    })
    assert(request)
    value.setCurrentSessionID("root")
    value.submit(request)
    const sent = requests().at(-1)
    assert(sent?.type === "sendMessage" && sent.messageID)
    assert.deepEqual(sent, { ...request, messageID: sent.messageID })
    assert.equal(value.currentSessionID(), "root")
    assert.equal(value.isSubmitting(id), true)
    const optimistic = unwrap(value.allMessages()[id]?.at(0))
    assert.equal(optimistic?.id, sent.messageID)
    const parts = structuredClone(unwrap(value.getParts(sent.messageID)))
    assert.equal(parts.length, 2)
    assert.equal(parts.find((part) => part.type === "text")?.text, request.text)
    assert.equal(parts.at(1)?.type, "file")

    await emit({ type: "messagesLoaded", sessionID: id, messages: [], mode: "replace" })
    assert.equal(value.allMessages()[id]?.at(0)?.id, sent.messageID)
    assert.deepEqual(structuredClone(unwrap(value.getParts(sent.messageID))), parts)
    if (variant === undefined) {
      await emit({ ...sent, type: "sendMessageFailed", error: "Test send failed" })
      assert.equal(value.allMessages()[id]?.length, 0)
      assert.equal(value.getParts(sent.messageID).length, 0)
      assert.equal(value.isSubmitting(id), false)
    } else {
      await emit({ type: "messageCreated", message: optimistic })
      assert.equal(value.allMessages()[id]?.length, 1)
      assert.deepEqual(structuredClone(unwrap(value.getParts(sent.messageID))), parts)
      for (const [index, part] of parts.entries()) {
        await emit({
          type: "partUpdated",
          sessionID: id,
          messageID: sent.messageID,
          part: { ...part, id: `${id}-part-${index}` },
        })
      }
      assert.deepEqual(
        value.getParts(sent.messageID).map((part) => part.id),
        [`${id}-part-0`, `${id}-part-1`],
      )
      const response = {
        id: `${id}-response`,
        sessionID: id,
        role: "assistant",
        parentID: sent.messageID,
        createdAt: info(id).createdAt,
        time: { created: 1, completed: 2 },
        finish: "tool-calls",
      }
      await emit({ type: "messagesLoaded", sessionID: id, messages: [optimistic, response] })
      assert.equal(value.isSubmitting(id), true)
      const completed =
        variant === "high"
          ? { ...response, finish: "stop" }
          : { ...response, finish: undefined, time: undefined, error: { name: "UnknownError" } }
      const history = { type: "messagesLoaded", sessionID: id, messages: [optimistic, completed], mode: "reconcile" }
      await emit(history)
      assert.equal(value.isSubmitting(id), false)
      value.submit({ ...request, text: "Queued follow-up" })
      const queued = requests().at(-1)
      assert(queued?.type === "sendMessage")
      await emit(history)
      assert.equal(value.isSubmitting(id), true)
      await emit({ ...queued, type: "sendMessageFailed", error: "Test send failed" })
      assert.equal(value.isSubmitting(id), false)
    }
    value.releaseSession(id)
  }
  value.setCurrentSessionID(undefined)
  await emit({ type: "agentsLoaded", agents: [{ name: "code" }, { name: "ask" }], defaultAgent: "code" })
  await emit({ type: "recentsLoaded", recents: [auto, first, external] })
  await catalog("org-a", [first.modelID, recommended.modelID, auto.modelID], recommended.modelID)
  choice(value.selected(), recommended)
  choice(value.selected("selection"), recommended)
  choice(value.modelForAgent("ask"), recommended)
  assert.deepEqual(writes(), [])

  observed.length = 0
  await catalog("org-b", [first.modelID, recommended.modelID, auto.modelID], first.modelID)
  choice(value.selected(), first)
  assert(observed.length > 0)
  assert(observed.every((selection) => selection?.modelID === first.modelID))
  for (const model of [undefined, "disallowed"]) {
    await catalog("org-a", [first.modelID, recommended.modelID], model)
    choice(value.selected(), first)
  }
  assert.deepEqual(writes(), [])

  await catalog(null, [auto.modelID, personal.modelID])
  choice(value.selected(), auto)
  value.selectModel(personal.providerID, personal.modelID)
  await settle()
  assert.equal(writes().length, 2)
  choice(value.selected(), personal)
  value.setSessionModel("selection", personal.providerID, personal.modelID)
  value.setCurrentSessionID("selection")
  const remembered = writes().slice()
  await catalog("org-a", [first.modelID, recommended.modelID], recommended.modelID)
  choice(value.selected(), recommended)
  choice(value.selected("selection"), recommended)
  choice(value.modelForAgent("code"), recommended)
  await catalog(null, [auto.modelID, personal.modelID])
  choice(value.selected(), personal)
  choice(value.modelForAgent("code"), personal)
  assert.deepEqual(writes(), remembered)

  await emit({ type: "modelSelectionsLoaded", selections: {} })
  await emit({ type: "recentsLoaded", recents: [auto] })
  choice(value.selected(), personal)
  setSettings({ model: "kilo/personal" })
  await settle()
  setSettings({ model: "kilo/a-recommended" })
  await catalog("org-a", [first.modelID, recommended.modelID], recommended.modelID)
  choice(value.selected(), recommended)
  setSettings({})
  await catalog(null, [auto.modelID, personal.modelID])
  choice(value.selected(), personal)
  assert.deepEqual(writes(), remembered)

  await catalog("org-a", [first.modelID, recommended.modelID], recommended.modelID)
  await emit({
    type: "messagesLoaded",
    sessionID: "history",
    messages: [
      {
        id: "history-message",
        sessionID: "history",
        role: "user",
        model: personal,
        createdAt: info("history").createdAt,
      },
    ],
  })
  choice(value.selected("history"), recommended)
  await catalog(null, [auto.modelID, personal.modelID])
  choice(value.selected("history"), personal)
  assert.deepEqual(writes(), remembered)

  for (const pending of ["retained", "loading", "empty"]) {
    if (pending === "retained")
      await catalog("org-a", [personal.modelID, recommended.modelID], recommended.modelID, false)
    if (pending === "loading") await emit({ type: "providersLoading" })
    if (pending === "empty") await catalog("org-a", [], recommended.modelID)
    assert.equal(value.selected(), null)
    assert.equal(value.selected("selection"), null)
    assert.equal(value.modelForAgent("code"), null)
    const before = requests().length
    assert.equal(value.sendMessage("blocked"), false)
    assert.equal(value.sendMessage("blocked explicit", personal.providerID, personal.modelID), false)
    assert.equal(value.sendCommand("blocked", ""), false)
    value.compact()
    assert.equal(requests().length, before)
    assert.deepEqual(writes(), remembered)
  }

  value.setSessionModel("external", external.providerID, external.modelID)
  await emit({ type: "providersLoading" })
  choice(value.selected("external"), external)
  await catalog("org-a", [first.modelID, recommended.modelID], recommended.modelID)
  const before = requests().length
  value.sendMessage("invalid explicit", personal.providerID, personal.modelID)
  value.sendCommand("invalid", "", undefined, undefined, undefined, undefined, undefined, undefined, {
    model: "kilo/personal",
  })
  assert.equal(requests().length, before)
  assert.deepEqual(writes(), remembered)
  assert.equal(value.sendMessage("effective model"), true)
  const message = requests().at(-1)
  assert(message?.type === "sendMessage")
  assert.equal(message.providerID, recommended.providerID)
  assert.equal(message.modelID, recommended.modelID)
  await emit({
    type: "messageCreated",
    message: {
      id: message.messageID,
      sessionID: "selection",
      role: "user",
      model: recommended,
      createdAt: info("selection").createdAt,
    },
  })
  await catalog(null, [auto.modelID, personal.modelID])
  choice(value.selected(), personal)
  await catalog("org-a", [first.modelID, recommended.modelID], recommended.modelID)
  await emit({ type: "sessionStatus", sessionID: "selection", status: "idle" })
  assert.equal(value.sendCommand("effective", ""), true)
  const command = requests().at(-1)
  assert(command?.type === "sendCommand")
  assert.equal(command.providerID, recommended.providerID)
  assert.equal(command.modelID, recommended.modelID)
  value.setCurrentSessionID("cloud:preview")
  assert.equal(value.sendMessage("cloud effective model"), true)
  const cloud = requests().at(-1)
  assert(cloud?.type === "importAndSend")
  assert.equal(cloud.providerID, recommended.providerID)
  assert.equal(cloud.modelID, recommended.modelID)
  assert.equal(value.sendCommand("cloud", ""), true)
  const imported = requests().at(-1)
  assert(imported?.type === "importAndSend")
  assert.equal(imported.providerID, recommended.providerID)
  assert.equal(imported.modelID, recommended.modelID)
  await catalog("org-a", [])
  const blocked = requests().length
  assert.equal(value.sendMessage("cloud unavailable"), false)
  assert.equal(value.sendCommand("cloud", "unavailable"), false)
  assert.equal(requests().length, blocked)
  await catalog("org-a", [first.modelID, recommended.modelID], recommended.modelID)
  assert.deepEqual(writes(), remembered)

  value.setCurrentSessionID(undefined)
  await emit({ type: "modelSelectionsLoaded", selections: { code: personal } })
  choice(value.selected(), recommended)
  await catalog(null, [auto.modelID, personal.modelID])
  choice(value.selected(), personal)
  await catalog("org-a", [auto.modelID, first.modelID, recommended.modelID], recommended.modelID)
  await emit({ type: "modelSelectionsLoaded", selections: { code: auto } })
  choice(value.selected(), auto)
  setSettings({ agent: { code: { model: "kilo/z-first" } } })
  await settle()
  choice(value.modelForAgent("code"), first)
  choice(value.selected(), auto)
  setSettings({})
  await emit({ type: "modelSelectionsLoaded", selections: {} })
  choice(value.selected(), recommended)
  assert.deepEqual(writes(), remembered)

  const snapshot = (scope?: string) =>
    JSON.stringify({
      session: value.currentSessionID(),
      draft: value.draftSessionID(),
      agent: value.selectedAgent(scope),
      model: value.selected(scope),
      variant: value.currentVariant(scope),
      foreground: [value.selectedAgent(), value.selected(), value.currentVariant()],
      modes: ["code", "ask"].map((name) => [
        value.modelForAgent(name),
        value.variantForAgent(name, value.modelForAgent(name)),
      ]),
      recents: value.recentModels(),
      usage: value.modelUsageHistory(),
      sessions: value.sessions(),
      messages: value.allMessages(),
      submitting: value.submitting(),
      cleared: value.userClearedSession(),
    })
  await catalog("org-a", [personal.modelID, first.modelID, recommended.modelID], recommended.modelID)
  await emit({ type: "modelSelectionsLoaded", selections: { code: first, ask: recommended } })
  value.selectAgent("ask")
  value.selectVariant("low")
  for (const scope of [undefined, "ses_command", "ses_background-command", "command-draft"]) {
    value.setCurrentSessionID(undefined)
    value.selectAgent("code")
    value.selectVariant("low")
    if (scope) {
      value.setSessionAgent(scope, "code")
      value.setSessionModel(scope, personal.providerID, personal.modelID)
      value.selectVariant("low", scope)
    }
    value.setCurrentSessionID(
      scope === "ses_background-command" ? "selection" : scope === "command-draft" ? undefined : scope,
    )
    value.setDraftSessionID(scope === "command-draft" ? scope : undefined)
    await settle()
    const initial = snapshot(scope)
    for (const reason of ["retained", "loading", "empty", "invalid", "malformed"]) {
      if (reason === "retained")
        await catalog("org-a", [personal.modelID, first.modelID, recommended.modelID], recommended.modelID, false)
      if (reason === "loading") await emit({ type: "providersLoading" })
      if (reason === "empty") await catalog("org-a", [])
      const before = snapshot(scope)
      const count = sent.length
      assert.equal(
        value.sendCommand(
          "review-test",
          "preserve selection",
          personal.providerID,
          personal.modelID,
          undefined,
          scope === "command-draft" ? scope : undefined,
          undefined,
          scope === "command-draft" ? null : scope,
          {
            agent: "ask",
            model: reason === "invalid" ? "kilo/unavailable" : reason === "malformed" ? "invalid" : undefined,
            variant: "high",
          },
        ),
        false,
        `${scope ?? "new"}: ${reason}`,
      )
      await settle()
      assert.equal(snapshot(scope), before, `${scope ?? "new"}: ${reason} mutated selection`)
      assert.deepEqual(sent.slice(count), [], "Rejected commands must not persist, seed, or send")
      await catalog("org-a", [personal.modelID, first.modelID, recommended.modelID], recommended.modelID)
      assert.equal(snapshot(scope), initial, "Restoring the catalog must restore the untouched model and variant")
    }
  }

  for (const configured of [false, true]) {
    const scope = `ses_command-${configured ? "configured" : "preferred"}`
    setSettings(configured ? { agent: { ask: { model: "kilo/z-first", variant: "high" } } } : {})
    await emit({ type: "modelSelectionsLoaded", selections: { code: first, ask: recommended } })
    value.setCurrentSessionID(scope)
    value.setSessionAgent(scope, "code")
    value.setSessionModel(scope, personal.providerID, personal.modelID)
    await settle()
    assert.equal(
      value.sendCommand(
        "review-test",
        "agent model",
        personal.providerID,
        personal.modelID,
        undefined,
        undefined,
        undefined,
        undefined,
        { agent: "ask" },
      ),
      true,
    )
    const request = requests().at(-1)
    assert(request?.type === "sendCommand")
    assert.equal(request.sessionID, scope)
    assert.equal(request.agent, "ask")
    assert.equal(request.modelID, configured ? first.modelID : recommended.modelID)
    assert.equal(request.variant, configured ? "high" : "low")
    assert.equal(value.selectedAgent(scope), "ask")
    choice(value.selected(scope), configured ? first : recommended)
  }
  setSettings({})
  await catalog(null, [auto.modelID, personal.modelID, first.modelID, recommended.modelID])
  await emit({ type: "modelSelectionsLoaded", selections: {} })
  value.setCurrentSessionID(undefined)
  value.selectAgent("ask")
  await settle()
  value.selectAgent("code")
  await settle()
  setSettings({ agent: { ask: { model: "kilo/a-recommended", variant: "high" } } })
  value.setCurrentSessionID("ses_command-cached")
  await settle()
  assert.equal(
    value.sendCommand(
      "review-test",
      "configured mode",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { agent: "ask" },
    ),
    true,
  )
  const configured = requests().at(-1)
  assert(configured?.type === "sendCommand")
  assert.equal(configured.modelID, recommended.modelID)
  assert.equal(configured.variant, "high")
  choice(value.selected(), recommended)

  setSettings({})
  await catalog("org-a", [personal.modelID, first.modelID, recommended.modelID], recommended.modelID)
  await emit({ type: "modelSelectionsLoaded", selections: { code: first, ask: recommended } })
  value.setCurrentSessionID(undefined)
  value.selectAgent("ask")
  value.setCurrentSessionID("selection")
  assert.equal(
    value.sendCommand(
      "review-test",
      "pending agent",
      personal.providerID,
      personal.modelID,
      undefined,
      undefined,
      undefined,
      null,
      { variant: "high" },
    ),
    true,
  )
  const pending = requests().at(-1)
  assert(pending?.type === "sendCommand")
  assert(pending.draftID)
  assert.equal(pending.sessionID, undefined)
  assert.equal(pending.agent, "ask")
  assert.equal(pending.modelID, recommended.modelID)
  assert.equal(pending.variant, "high")
  assert.equal(value.selectedAgent(pending.draftID), "ask")
  choice(value.selected(pending.draftID), recommended)
  assert.equal(value.currentVariant(pending.draftID), "high")
  assert.equal(value.variantForAgent("ask", recommended), "low")
  const persisted = sent.length
  assert.equal(
    value.sendCommand(
      "review-test",
      "explicit model",
      first.providerID,
      first.modelID,
      undefined,
      undefined,
      undefined,
      null,
      { agent: "ask", model: "kilo/personal", variant: "high" },
    ),
    true,
  )
  const accepted = requests().at(-1)
  assert(accepted?.type === "sendCommand")
  assert.equal(accepted.sessionID, undefined)
  assert(accepted.draftID)
  assert.equal(accepted.agent, "ask")
  assert.equal(accepted.modelID, personal.modelID)
  assert.equal(accepted.variant, "high")
  assert.equal(value.currentSessionID(), "selection")
  assert.equal(value.draftSessionID(), accepted.draftID)
  choice(value.selected(accepted.draftID), personal)
  assert.equal(value.selectedAgent(accepted.draftID), "ask")
  assert.equal(value.currentVariant(accepted.draftID), "high")
  choice(value.modelForAgent("ask"), recommended)
  assert.equal(
    sent.slice(persisted).some((message) => message.type === "persistModelSelection"),
    false,
  )
  await emit({ type: "sessionCreated", session: info("ses_command-promoted"), draftID: accepted.draftID })
  choice(value.selected("ses_command-promoted"), personal)
  assert.equal(value.selectedAgent("ses_command-promoted"), "ask")
  assert.equal(value.currentVariant("ses_command-promoted"), "high")
  assert(
    sent
      .slice(persisted)
      .some(
        (message) =>
          message.type === "persistVariant" &&
          message.key === "session/ses_command-promoted/kilo/personal" &&
          message.value === "high",
      ),
  )
  assert.equal(
    value.sendCommand(
      "review-test",
      "scoped draft",
      first.providerID,
      first.modelID,
      undefined,
      "command-draft",
      undefined,
      null,
    ),
    true,
  )
  const scoped = requests().at(-1)
  assert(scoped?.type === "sendCommand")
  assert.equal(scoped.draftID, "command-draft")
  assert.equal(scoped.agent, "code")
  assert.equal(scoped.modelID, personal.modelID)
  assert.equal(scoped.variant, "low")
  assert.equal(value.currentSessionID(), "ses_command-promoted")
  value.setDraftSessionID(undefined)

  const key = "acceptance:session:composer"
  const image = { id: "image", filename: "image.png", mime: "image/png", dataUrl: "data:image/png;base64,cGl4ZWw=" }
  const input = () => {
    const element = host.querySelector<HTMLTextAreaElement>("textarea.prompt-input")
    assert(element)
    return element
  }
  const seed = async (text: string) => {
    setComposer(false)
    await settle()
    value.setCurrentSessionID("composer")
    await emit({ type: "sessionStatus", sessionID: "composer", status: "idle" })
    savePromptDraft(key, text, [], [image])
    setComposer(true)
    await settle()
    await emit({
      type: "commandsLoaded",
      commands: [
        { name: "review-test", description: "Test command", hints: [] },
        { name: "unavailable-test", description: "Unavailable command", hints: [], model: "kilo/unavailable" },
      ],
    })
    assert.equal(input().value, text)
  }
  const submit = (enter: boolean) => {
    if (enter) {
      input().dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
      return
    }
    const button = host.querySelector<HTMLButtonElement>('[aria-label="prompt.action.send"]')
    assert(button)
    button.click()
  }
  const retained = (text: string, count: number) => {
    assert.equal(requests().length, count)
    assert.equal(input().value, text)
    assert.equal(drafts.get(key), text)
    assert.deepEqual(imageDrafts.get(key), [image])
    assert(host.querySelector('img[src="data:image/png;base64,cGl4ZWw="]'))
  }
  for (const text of ["preserve this draft", "/review-test preserve this draft"]) {
    for (const empty of [false, true]) {
      await seed(text)
      if (empty) await catalog("org-a", [])
      if (!empty) await emit({ type: "providersLoading" })
      const count = requests().length
      submit(empty)
      await settle()
      retained(text, count)
    }
    await catalog("org-a", [recommended.modelID], recommended.modelID)
    const count = requests().length
    submit(false)
    await settle()
    assert.equal(requests().length, count + 1)
    const request = requests().at(-1)
    assert(request?.type === (text.startsWith("/") ? "sendCommand" : "sendMessage"))
    assert.deepEqual(request.files, [{ mime: image.mime, url: image.dataUrl, filename: image.filename }])
    assert.equal(input().value, "")
    assert.equal(drafts.has(key), false)
    assert.equal(imageDrafts.has(key), false)
    assert.equal(host.querySelector('img[src="data:image/png;base64,cGl4ZWw="]'), null)
  }
  await seed("/unavailable-test preserve command")
  const rejected = requests().length
  submit(false)
  await settle()
  retained("/unavailable-test preserve command", rejected)

  for (const text of ["prepare @terminal", "/review-test prepare @terminal"]) {
    await catalog("org-a", [recommended.modelID], recommended.modelID)
    await seed(text)
    const count = requests().length
    const start = sent.length
    submit(true)
    const request = sent.slice(start).find((message) => message.type === "requestTerminalContext")
    assert(request?.type === "requestTerminalContext")
    await emit({ type: "providersLoading" })
    await emit({ type: "terminalContextResult", requestId: request.requestId, content: "terminal output" })
    retained(text, count)
  }
  setComposer(false)
  await settle()
  await catalog("org-a", [recommended.modelID], recommended.modelID)

  setSharing(true)
  await settle()
  await emit({ type: "sessionsLoaded", sessions: unwrap(value.sessions()) })
  value.setCurrentSessionID("root")
  await emit({ type: "sessionTurnClosed", sessionID: "root", reason: "completed", eventID: "seeded" })
  await check("root", "done")
  await emit({ type: "webviewActiveChanged", active: true })
  await check("root", "idle")
  await check("background", "idle")
  for (const update of [setOperation, setRun]) {
    update(true)
    await settle()
    card("busy")
    update(false)
    await settle()
    card("idle")
  }

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
  setInspector(true)
  await check("root", "busy")
  await check("task-child", "busy")
  await check("task-grand", "idle")
  assert.equal(value.currentSessionID(), "root")
  host.querySelector<HTMLElement>('[data-tab-id="task-grand"] [role="tab"]')!.click()
  await settle()
  assert.equal(active(), "task-grand")
  assert.equal(value.currentSessionID(), "root")
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
  for (const update of [setOperation, setRun]) {
    update(true)
    await settle()
    card("waiting")
    update(false)
  }
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
  await check("root", "idle")
  await check("task-grand", "done")
  assert.equal(value.scopedSuggestions("root").length, 1)
  await emit({ type: "suggestionResolved", requestID: "suggestion" })
  await check("root", "idle")
  await check("task-grand", "idle")
  assert.equal(value.suggestions().length, 0)

  await emit({ type: "webviewActiveChanged", active: true })
  await emit({ type: "sessionTurnClosed", sessionID: "task-child", reason: "completed", parentID: "root" })
  await check("task-child", "done")
  await check("root", "idle")
  setInspected(["task-grand", "task-child"])
  await check("task-child", "done")
  setInspected(["task-child"])
  await check("task-child", "done")
  setInspected(["task-child", "task-grand"])
  await check("task-child", "done")
  setActive("task-grand")
  await settle()
  const tab = host.querySelector<HTMLElement>('[data-tab-id="task-child"] [role="tab"]')
  assert(tab)
  tab.click()
  await check("task-child", "idle")
  assert.equal(peer.value?.activityFor("task-child"), "idle")
  await emit({ type: "sessionTurnClosed", sessionID: "task-child", reason: "completed", parentID: "root" })
  await check("task-child", "done")
  setInspector(false)
  await settle()
  setInspector(true)
  await check("task-child", "idle")
  assert.equal(value.currentSessionID(), "root")
  await emit({ type: "sessionTurnClosed", sessionID: "task-child", reason: "error", parentID: "root" })
  await check("task-child", "error")
  await check("root", "idle")
  await emit({ type: "sessionStatus", sessionID: "root", status: "busy" })
  await check("root", "busy")
  await emit({ type: "sessionStatus", sessionID: "root", status: "idle" })
  await check("root", "idle")

  await emit({ type: "sessionStatus", sessionID: "root", status: "busy" })
  await emit({
    type: "suggestionRequest",
    suggestion: { id: "review", sessionID: "root", text: "Review the changes", actions: [] },
  })
  await check("root", "busy")
  await emit({ type: "sessionStatus", sessionID: "root", status: "idle" })
  await check("root", "done")
  assert.equal(value.closeReason(), undefined)
  assert.equal(value.suggestions().length, 1)
  await emit({ type: "sessionTurnClosed", sessionID: "root", reason: "completed", eventID: "review-finished" })
  await check("root", "done")
  value.acknowledge("root")
  await check("root", "idle")
  await emit({ type: "sessionStatus", sessionID: "root", status: "busy" })
  await check("root", "busy")
  await emit({ type: "suggestionResolved", requestID: "review" })
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

  await emit({ type: "sessionStatus", sessionID: "root", status: "busy" })
  value.abort()
  assert.deepEqual(sent.at(-1), { type: "abort", sessionID: "root", scope: "session" })
  await emit({ type: "sessionTurnClosed", sessionID: "root", reason: "interrupted" })
  await emit({ type: "sessionStatus", sessionID: "root", status: "idle" })
  await check("root", "idle")
  await emit({ type: "sessionStatus", sessionID: "root", status: "busy" })
  await emit({ type: "sessionTurnClosed", sessionID: "root", reason: "completed" })
  await emit({ type: "sessionStatus", sessionID: "root", status: "idle" })
  await check("root", "done")
  await emit({ type: "sessionStatus", sessionID: "root", status: "busy" })
  await emit({ type: "sessionStatus", sessionID: "root", status: "idle" })

  value.setCurrentSessionID("background")
  await emit({ type: "sessionStatus", sessionID: "background", status: "busy" })
  await check("background", "busy")
  await emit({ type: "connectionState", state: "connecting" })
  await check("background", "busy")
  await emit({ type: "connectionState", state: "connected" })
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
  await emit({ type: "connectionState", state: "connecting" })
  await check("background", "waiting")
  await emit({ type: "connectionState", state: "connected" })
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
  for (const update of [setOperation, setRun]) {
    update(true)
    await settle()
    card("error")
    update(false)
  }
  assert.equal(value.inUseFor("root"), false)
  await emit({ type: "sessionError", eventID: "later-overflow", error: { name: "ContextOverflowError" } })
  await emit({ type: "sessionTurnClosed", sessionID: "root", reason: "completed" })
  await check("root", "error")

  await emit({ type: "sessionStatus", sessionID: "root", status: "busy" })
  await check("root", "busy")
  for (const status of ["busy", "retry"] as const) {
    await emit({ type: "sessionStatus", sessionID: "root", status })
    await emit({
      type: "sessionError",
      sessionID: "root",
      eventID: `root-${status}-error`,
      error: { name: "ProviderError", message: "Request Entity Too Large" },
    })
    await check("root", "error")
    await emit({ type: "sessionStatus", sessionID: "root", status })
    await check("root", status)
    assert.equal(value.closeReason(), undefined)
    assert(value.messages().some((message) => message.sessionErrorID === `root-${status}-error`))
  }
  await emit({ type: "sessionTurnClosed", sessionID: "root", reason: "completed" })
  await emit({ type: "sessionStatus", sessionID: "root", status: "idle" })
  await check("root", "done")
  await emit({ type: "sessionStatus", sessionID: "root", status: "busy" })
  await emit({ type: "sessionError", sessionID: "root", eventID: "terminal-error", error: { name: "ProviderError" } })
  await emit({ type: "sessionStatus", sessionID: "root", status: "idle" })
  await check("root", "error")

  for (const order of ["before", "after"]) {
    await emit({ type: "sessionStatus", sessionID: "root", status: "busy" })
    await emit({
      type: "sessionError",
      sessionID: "root",
      eventID: `overflow-${order}`,
      error: { name: "ContextOverflowError", data: { message: "Request Entity Too Large" } },
    })
    await check("root", "busy")
    await emit({
      type: "sessionError",
      sessionID: "root",
      eventID: `retry-${order}`,
      error: { name: "ContextOverflowError", data: { message: "Request Entity Too Large" } },
    })
    await emit({
      type: "messageCreated",
      message: {
        id: `recovered-${order}`,
        sessionID: "root",
        role: "assistant",
        createdAt: new Date().toISOString(),
        finish: "stop",
      },
    })
    if (order === "before") await emit({ type: "sessionStatus", sessionID: "root", status: "idle" })
    await emit({ type: "sessionTurnClosed", sessionID: "root", reason: "completed" })
    if (order === "after") await emit({ type: "sessionStatus", sessionID: "root", status: "idle" })
    await check("root", "done")
    assert.equal(value.closeReason(), "completed")
    assert.equal(
      value.messages().some((message) => message.sessionErrorID === `overflow-${order}`),
      false,
    )
    assert.equal(
      value.messages().some((message) => message.sessionErrorID === `retry-${order}`),
      false,
    )
    assert.equal(terminal({ reason: value.closeReason(), messages: value.visibleMessages(), todos: [] }), undefined)
    assert.equal(
      value.messages().some((message) => message.sessionErrorID === "root-error"),
      true,
    )
    assert.equal(
      value.messages().some((message) => message.sessionErrorID === "later-overflow"),
      true,
    )
  }

  for (const reason of ["error", "completed"]) {
    await emit({ type: "sessionStatus", sessionID: "root", status: "busy" })
    await emit({
      type: "sessionError",
      sessionID: "root",
      eventID: `unrecovered-${reason}`,
      error: { name: "ContextOverflowError", data: { message: "Context limit reached" } },
    })
    if (reason === "completed") {
      await emit({ type: "sessionError", sessionID: "root", eventID: "terminal-error", error: { name: "APIError" } })
    }
    await emit({ type: "sessionTurnClosed", sessionID: "root", reason })
    await emit({ type: "sessionStatus", sessionID: "root", status: "idle" })
    await emit({ type: "sessionTurnClosed", sessionID: "root", reason: "completed" })
    await check("root", "error")
    assert.equal(value.closeReason(), "error")
    assert.equal(
      value.messages().some((message) => message.sessionErrorID === `unrecovered-${reason}`),
      true,
    )
  }

  // "done" clears when the user switches TO that tab (the focus transition);
  // an unresolved attention state ("waiting") never clears on focus.
  await emit({ type: "sessionStatus", sessionID: "background", status: "idle" })
  await emit({ type: "sessionTurnClosed", sessionID: "background", reason: "completed" })
  await check("background", "done")
  assert.equal(value.currentSessionID(), "root")
  value.selectSession("background")
  await check("background", "idle")
  assert.equal(value.closeReason(), "completed")
  assert.equal(peer.value?.activityFor("background"), "idle")

  setReview(true)
  await settle()
  await emit({
    type: "sessionTurnClosed",
    sessionID: "background",
    eventID: "review-completed",
    reason: "completed",
  })
  await check("background", "done")
  setReview(false)
  await check("background", "idle")
  assert.equal(value.currentSessionID(), "background")
  assert.equal(value.closeReason(), "completed")
  assert.equal(peer.value?.activityFor("background"), "idle")
  await emit({
    type: "sessionTurnClosed",
    sessionID: "background",
    eventID: "review-completed",
    reason: "completed",
  })
  await check("background", "idle")

  await emit({ type: "sessionTurnClosed", sessionID: "background", reason: "completed" })
  await check("background", "done")
  await focus(false)
  await check("background", "done")
  await focus(true)
  await check("background", "done")

  await emit({ type: "webviewActiveChanged", active: false })
  await emit({
    type: "sessionTurnClosed",
    sessionID: "background",
    eventID: "next-completed",
    reason: "completed",
  })
  await emit({ type: "sessionAcknowledged", sessionID: "background", eventID: "review-completed" })
  await check("background", "done")
  value.selectSession("root")
  value.selectSession("background")
  await focus(false)
  await focus(true)
  await check("background", "done")
  await emit({ type: "webviewActiveChanged", active: true })
  await check("background", "idle")
  assert.equal(peer.value?.activityFor("background"), "idle")

  await emit({
    type: "questionRequest",
    question: {
      id: "attention",
      sessionID: "background",
      questions: [{ question: "Continue?", header: "Confirm", options: [] }],
    },
  })
  await check("background", "waiting")
  value.setCurrentSessionID("root")
  await settle()
  value.setCurrentSessionID("background")
  await check("background", "waiting")
  await emit({ type: "questionResolved", requestID: "attention" })
  value.setCurrentSessionID("root")
  await settle()

  await emit({ type: "sessionStatus", sessionID: "root", status: "busy" })
  await emit({ type: "sessionStatus", sessionID: "root", status: "idle" })
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
