import assert from "node:assert/strict"
import { Window } from "happy-dom"

const window = new Window({ url: "http://localhost" })
Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  HTMLButtonElement: window.HTMLButtonElement,
  HTMLInputElement: window.HTMLInputElement,
  SVGElement: window.SVGElement,
  ShadowRoot: window.ShadowRoot,
  customElements: window.customElements,
  MutationObserver: window.MutationObserver,
  ResizeObserver: window.ResizeObserver,
  CustomEvent: window.CustomEvent,
  Event: window.Event,
  KeyboardEvent: window.KeyboardEvent,
  MessageEvent: window.MessageEvent,
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  getComputedStyle: window.getComputedStyle.bind(window),
})

globalThis.acquireVsCodeApi = () => ({
  postMessage: () => undefined,
  getState: () => undefined,
  setState: () => undefined,
})

const { render } = await import("solid-js/web")
const { VSCodeProvider } = await import("../../webview-ui/src/context/vscode")
const { LanguageContext } = await import("../../webview-ui/src/context/language")
const { ProviderContext } = await import("../../webview-ui/src/context/provider")
const { SessionContext } = await import("../../webview-ui/src/context/session")
const { NotificationsContext } = await import("../../webview-ui/src/context/notifications")
const { WorktreeModeProvider } = await import("../../webview-ui/src/context/worktree-mode")
const { ModelSelector } = await import("../../webview-ui/src/components/shared/ModelSelector")
const { KiloNotifications } = await import("../../webview-ui/src/components/chat/KiloNotifications")

const model = { id: "new", name: "New", providerID: "kilo", providerName: "Kilo" }
const selection = { providerID: "kilo", modelID: "new" }
const provider = {
  providers: () => ({ kilo: { id: "kilo", name: "Kilo", models: { new: model } } }),
  connected: () => ["kilo"],
  defaults: () => ({}),
  defaultSelection: () => selection,
  models: () => [model],
  findModel: (value: typeof selection | null) =>
    value?.providerID === selection.providerID && value.modelID === selection.modelID ? model : undefined,
  authMethods: () => ({}),
  authStates: () => ({}),
  isModelValid: (value: typeof selection | null) =>
    value?.providerID === selection.providerID && value.modelID === selection.modelID,
}
const language = {
  locale: () => "en",
  setLocale: () => undefined,
  userOverride: () => "",
  t: (key: string, params?: { model?: string }) => (params?.model ? `${key}:${params.model}` : key),
}
const notifications = {
  notifications: () => [{ id: "notification", title: "Try a model", message: "Try it", suggestModelId: "new" }],
  filteredNotifications: () => [{ id: "notification", title: "Try a model", message: "Try it", suggestModelId: "new" }],
  dismiss: () => undefined,
}

type ModelCall = [string, string, string | undefined, string | undefined]

function mount(inAgentManager: boolean, child: () => unknown) {
  const calls: ModelCall[] = []
  const session = {
    selected: () => null,
    selectModel: (...args: ModelCall) => calls.push(args),
    modelUsageHistory: () => ({}),
    favoriteModels: () => [],
    recentModels: () => [],
    toggleFavorite: () => undefined,
    currentSessionID: () => "session-a",
    draftSessionID: () => undefined,
  }
  const root = document.createElement("div")
  document.body.append(root)
  const content = () => (
    <ProviderContext.Provider value={provider as never}>
      <LanguageContext.Provider value={language as never}>
        <SessionContext.Provider value={session as never}>
          <NotificationsContext.Provider value={notifications as never}>{child()}</NotificationsContext.Provider>
        </SessionContext.Provider>
      </LanguageContext.Provider>
    </ProviderContext.Provider>
  )
  const dispose = render(
    () => (
      <VSCodeProvider>
        {inAgentManager ? <WorktreeModeProvider>{content()}</WorktreeModeProvider> : content()}
      </VSCodeProvider>
    ),
    root,
  )
  return {
    calls,
    root,
    dispose: () => {
      dispose()
      root.remove()
    },
  }
}

async function settle() {
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 25))
}

async function selectFromPicker(inAgentManager: boolean, expectedScope: "global" | "session") {
  const mounted = mount(inAgentManager, () => <ModelSelector sessionID={() => "session-a"} portal={false} />)
  const trigger = mounted.root.querySelector<HTMLButtonElement>("button")
  assert.ok(trigger, "model selector trigger rendered")
  trigger.click()
  await settle()

  const input = document.querySelector<HTMLInputElement>(".model-selector-search")
  const body = document.querySelector<HTMLElement>(".model-selector-body")
  assert.ok(input, "model selector search rendered")
  assert.ok(body, "model selector body rendered")
  input.value = "new"
  input.dispatchEvent(new Event("input", { bubbles: true }))
  await settle()
  body.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
  await settle()

  assert.deepEqual(mounted.calls, [["kilo", "new", "session-a", expectedScope]])
  mounted.dispose()
}

async function selectFromNotification(inAgentManager: boolean, expectedScope: "global" | "session") {
  const mounted = mount(inAgentManager, () => <KiloNotifications sessionID={() => "session-a"} />)
  await settle()

  const action = mounted.root.querySelector<HTMLButtonElement>(".kilo-notifications-action-btn")
  assert.ok(action, "notification model action rendered")
  action.click()
  await settle()

  assert.deepEqual(mounted.calls, [["kilo", "new", "session-a", expectedScope]])
  mounted.dispose()
}

await selectFromPicker(false, "global")
await selectFromPicker(true, "session")
await selectFromNotification(false, "global")
await selectFromNotification(true, "session")
