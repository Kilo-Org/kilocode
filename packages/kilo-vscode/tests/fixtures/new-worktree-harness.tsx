import assert from "node:assert/strict"
import { Window } from "happy-dom"
import type { AgentProjectSnapshot, Readiness, WebviewMessage } from "../../webview-ui/src/types/messages"

type Options = {
  projectId?: string
  activeProjectId?: string
  projects?: () => AgentProjectSnapshot[]
  mode?: unknown
  features?: Record<string, boolean>
  state?: Record<string, unknown>
}

const project = (id: string): AgentProjectSnapshot => ({
  id,
  root: `/${id}`,
  label: id,
  pinned: id === "p1",
  active: id === "p1",
  expanded: true,
  initialized: true,
  missing: false,
})

/** The happy-dom shell shared by the New Worktree dialog fixtures. */
export async function newWorktreeHarness(options: Options = {}) {
  const window = new Window({ url: "http://localhost" })
  Object.defineProperty(window, "origin", { value: window.location.origin })
  const sent: WebviewMessage[] = []
  // A valid saved model is required, or Create stays disabled regardless of readiness.
  const saved = options.state ?? {
    advancedDialogSelections: { model: { providerID: "kilo", modelID: "m1" } },
    advancedDialogImages: [
      { id: "img", filename: "shot.png", mime: "image/png", dataUrl: "data:image/png;base64,AAAA" },
    ],
  }
  const api = {
    postMessage: (message: WebviewMessage) => sent.push(structuredClone(message)),
    getState: () => saved,
    setState: () => {},
  }

  Object.assign(globalThis, {
    window,
    document: window.document,
    navigator: window.navigator,
    localStorage: window.localStorage,
    Node: window.Node,
    NodeFilter: window.NodeFilter,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    HTMLHeadElement: window.HTMLHeadElement,
    HTMLButtonElement: window.HTMLButtonElement,
    HTMLInputElement: window.HTMLInputElement,
    HTMLTextAreaElement: window.HTMLTextAreaElement,
    SVGElement: window.SVGElement,
    MutationObserver: window.MutationObserver,
    IntersectionObserver: window.IntersectionObserver,
    ResizeObserver: window.ResizeObserver,
    CustomEvent: window.CustomEvent,
    customElements: window.customElements,
    Event: window.Event,
    KeyboardEvent: window.KeyboardEvent,
    MouseEvent: window.MouseEvent,
    MessageEvent: window.MessageEvent,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    getComputedStyle: window.getComputedStyle.bind(window),
    acquireVsCodeApi: () => api,
  })

  const { render } = await import("solid-js/web")
  const { Show, createSignal, onCleanup, onMount } = await import("solid-js")
  const { DialogProvider, useDialog } = await import("@kilocode/kilo-ui/context/dialog")
  const { Toast } = await import("@kilocode/kilo-ui/toast")
  const { VSCodeProvider } = await import("../../webview-ui/src/context/vscode")
  const { ServerProvider } = await import("../../webview-ui/src/context/server")
  const { ConfigContext } = await import("../../webview-ui/src/context/config")
  const { LanguageContext } = await import("../../webview-ui/src/context/language")
  const { NotificationsProvider } = await import("../../webview-ui/src/context/notifications")
  const { ProviderProvider } = await import("../../webview-ui/src/context/provider")
  const { SessionProvider } = await import("../../webview-ui/src/context/session")
  const { SpeechToTextModelsProvider } = await import("../../webview-ui/src/context/speech-to-text-models")
  const { NewWorktreeDialog } = await import("../../webview-ui/agent-manager/NewWorktreeDialog")
  const { createModeRouter } = await import("../../webview-ui/agent-manager/mode-router")
  const { post } = await import("../../webview-ui/src/utils/webview-message")

  const [features, setFeatures] = createSignal({
    indexing: false,
    sandboxControls: false,
    backgroundSubagents: false,
    speechToText: false,
    ...options.features,
  })
  const config = {
    config: () => ({}),
    globalConfig: () => ({}),
    globalDraft: () => ({}),
    projectConfig: () => ({}),
    collections: () => ({}),
    settings: () => ({}),
    shortcuts: () => ({ bindings: {}, selection: false }),
    features,
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
  const language = { locale: () => "en", setLocale: () => {}, userOverride: () => "", t: (key: string) => key }
  const projects = options.projects ?? (() => [project("p1"), project("p2")])
  const closes = { value: 0 }
  const [open, setOpen] = createSignal(false)
  const [projectId, setProjectId] = createSignal(options.projectId ?? "p1")
  const [activeProjectId] = createSignal(options.activeProjectId ?? "p1")
  const Opener = () => {
    const dialog = useDialog()
    const [closing, setClosing] = createSignal(false)
    onCleanup(() => dialog.close())
    onMount(() =>
      dialog.show(
        () => (
          <NewWorktreeDialog
            closing={closing}
            mode={(options.mode ?? createModeRouter()) as never}
            projectId={projectId()}
            activeProjectId={activeProjectId()}
            projects={projects}
            onClose={() => {
              closes.value++
              dialog.close()
            }}
          />
        ),
        () => setClosing(true),
      ),
    )
    return null
  }

  const host = document.createElement("div")
  document.body.append(host)
  const dispose = render(
    () => (
      <VSCodeProvider>
        <ServerProvider>
          <ProviderProvider>
            <ConfigContext.Provider value={config as never}>
              <LanguageContext.Provider value={language as never}>
                <NotificationsProvider>
                  <SessionProvider>
                    <SpeechToTextModelsProvider>
                      <DialogProvider>
                        <Show when={open()}>
                          <Opener />
                        </Show>
                        <Toast.Region />
                      </DialogProvider>
                    </SpeechToTextModelsProvider>
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
  const emit = async (data: { type: string; [key: string]: unknown }) => {
    post(structuredClone(data))
    await settle()
  }

  const model = { providerID: "kilo", modelID: "m1" }
  await emit({ type: "agentsLoaded", agents: [{ name: "code" }], defaultAgent: "code" })
  await emit({
    type: "providersLoaded",
    organizationId: null,
    ready: true,
    providers: { kilo: { id: "kilo", name: "Kilo", models: { m1: { id: "m1", name: "M1" } } } },
    connected: ["kilo"],
    defaults: { kilo: "m1" },
    defaultSelection: model,
    authMethods: {},
    authStates: {},
  })

  const checks = () =>
    sent.filter(
      (item): item is Extract<WebviewMessage, { type: "agentManager.checkReadiness" }> =>
        item.type === "agentManager.checkReadiness",
    )
  const creates = () => sent.filter((item) => item.type === "agentManager.createMultiVersion")
  const submit = () => {
    const button = document.querySelector<HTMLButtonElement>(".am-nv-submit")
    assert.ok(button, "missing Create button")
    return button
  }
  const prompt = () => {
    const area = document.querySelector<HTMLTextAreaElement>(".am-prompt-input")
    assert.ok(area, "missing prompt")
    return area
  }
  const readiness = () =>
    sent.flatMap((item) =>
      item.type === "telemetry" && item.event === "Agent Manager Worktree Readiness" ? [item.properties] : [],
    )
  const card = () => document.querySelector<HTMLElement>(".am-readiness")
  const reply = (projectId: string, requestID: string, result: Readiness) =>
    emit({ type: "agentManager.readiness", projectId, requestID, result })
  const shortcut = () =>
    prompt().dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Enter", metaKey: true, ctrlKey: true, bubbles: true }) as never,
    )
  // The dialog stack disposes a closed dialog after its 100 ms exit transition.
  const close = async () => {
    setOpen(false)
    await new Promise((done) => setTimeout(done, 150))
    await settle()
  }
  const mount = async (next?: { projectId?: string; activeProjectId?: string }) => {
    setProjectId(next?.projectId ?? options.projectId ?? "p1")
    if (open()) await close()
    await new Promise((done) => setTimeout(done, 150))
    sent.length = 0
    closes.value = 0
    setOpen(true)
    await settle()
    // Mounting checks the selected project once.
    assert.equal(checks().length, 1)
    assert.equal(checks().at(0)?.projectId, projectId())
    return checks().at(0)!.requestID
  }

  return {
    window,
    sent,
    features,
    setFeatures,
    settle,
    emit,
    checks,
    creates,
    submit,
    prompt,
    readiness,
    card,
    reply,
    shortcut,
    close,
    mount,
    open,
    setOpen,
    closes,
    dispose,
  }
}
