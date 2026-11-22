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
  customElements: window.customElements,
  Event: window.Event,
  MessageEvent: window.MessageEvent,
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  getComputedStyle: window.getComputedStyle.bind(window),
  acquireVsCodeApi: () => api,
})

// Every module below is imported dynamically for one reason: it touches the browser
// globals assigned above at module scope, so it must not be evaluated before them.
const { render } = await import("solid-js/web")
const { VSCodeProvider } = await import("../../webview-ui/src/context/vscode")
const { ProviderProvider } = await import("../../webview-ui/src/context/provider")
const { DialogProvider } = await import("@kilocode/kilo-ui/context/dialog")
const { LanguageContext } = await import("../../webview-ui/src/context/language")
const { ModelSelectorBase } = await import("../../webview-ui/src/components/shared/ModelSelector")
const { dict } = await import("../../webview-ui/src/i18n/en")
const { post } = await import("../../webview-ui/src/utils/webview-message")

const failureCopy = dict["dialog.model.loadFailed"]
assert.equal(failureCopy, "Could not load providers for this project.")

const language = {
  locale: () => "en",
  setLocale: () => {},
  userOverride: () => "",
  t: (key: string) => dict[key as keyof typeof dict] ?? key,
}

const settle = async () => {
  await Promise.resolve()
  await window.happyDOM.waitUntilComplete()
}

const emit = async (data: { type: string; [key: string]: unknown }) => {
  post(structuredClone(data))
  await settle()
}

const previous = {
  providers: { old: { id: "old", name: "Old", models: { "old-model": { id: "old-model", name: "Old Model" } } } },
  connected: ["old"],
  defaults: {},
  ready: true,
  defaultSelection: { providerID: "old", modelID: "old-model" },
  authMethods: {},
  authStates: {},
}
const failed = {
  providers: {},
  connected: [],
  defaults: {},
  ready: false,
  defaultSelection: { providerID: "kilo", modelID: "kilo-auto" },
  authMethods: {},
  authStates: {},
  loadFailed: true,
}

const failures: string[] = []
const check = (step: string, body: () => void) => {
  try {
    body()
  } catch (error) {
    failures.push(`${step}: ${(error as Error).message}`)
  }
}

/**
 * Renders one real ModelSelectorBase over the real ProviderProvider and drives it through a
 * project switch: an initial provider payload, the loading reset, then a failed read.
 */
async function scenario(name: string, value: ModelSelection | null, previousLabel: RegExp) {
  const host = document.createElement("div")
  document.body.append(host)
  const selector = () => {
    const label = host.querySelector(".model-selector-trigger-label")
    if (label) return label.textContent ?? ""
    const button = host.querySelector("button")
    return button?.getAttribute("aria-label") ?? ""
  }
  // The provider context asks for providers while it is created, so the baseline is taken
  // before the render call rather than after it.
  const before = sent.length
  const dispose = render(
    () => (
      <VSCodeProvider>
        <DialogProvider>
          <ProviderProvider>
            <LanguageContext.Provider value={language as never}>
              <ModelSelectorBase value={value} onSelect={() => {}} allowClear={false} placement="bottom-start" />
            </LanguageContext.Provider>
          </ProviderProvider>
        </DialogProvider>
      </VSCodeProvider>
    ),
    host,
  )
  const report = (step: string) =>
    console.log(`RESULT ${JSON.stringify({ scenario: name, step, trigger: selector(), text: host.textContent ?? "" })}`)
  const observed: Record<string, string> = {}
  try {
    await settle()
    check(`${name}: requests providers on mount`, () => {
      assert.ok(
        sent.slice(before).some((message) => message.type === "requestProviders"),
        "the provider view asks the extension for providers",
      )
    })

    await emit({ type: "providersLoaded", ...previous })
    observed.previous = selector()
    report("previous project")
    check(`${name}: previous project`, () => {
      assert.match(observed.previous!, previousLabel, "the trigger names the previous project's state")
      assert.ok(!host.textContent?.includes(failureCopy), "the failure copy is absent")
    })

    // A project switch drops every row of the previous read before the new one arrives.
    await emit({ type: "providersReset" })
    await emit({ type: "providersLoading" })
    observed.loading = selector()
    report("loading")
    check(`${name}: loading`, () => {
      assert.ok(!host.textContent?.includes(failureCopy), "the failure copy is still absent while loading")
      // With no selection to name, the trigger can only offer the catalog, so it reports that no
      // provider is available: the rows from the previous read are gone.
      if (value === null) assert.equal(observed.loading, "No providers", "the previous provider rows are gone")
    })

    await emit({ type: "providersLoaded", ...failed })
    observed.failed = selector()
    report("failed read")
    check(`${name}: failed read`, () => {
      const text = host.textContent ?? ""
      assert.equal(observed.failed, failureCopy, "the trigger shows the failure copy")
      assert.ok(!observed.failed!.includes("Old"), "the trigger shows no provider name from the earlier payload")
      assert.ok(!observed.failed!.includes("old-model"), "the trigger shows no model from the earlier payload")
      assert.equal(text.split(failureCopy).length - 1, 1, "the failure copy appears exactly once")
    })
  } finally {
    dispose()
    host.remove()
  }
  return observed
}

try {
  // A project with no saved model for the surface: before the failure it offers the catalog.
  await scenario("no saved selection", null, /Select model/)
  // The surface reports a selection, so the label must still become the failure copy.
  await scenario("saved selection", { providerID: "kilo", modelID: "old-model" }, /old-model/)
} finally {
  console.log(`RESULT ${JSON.stringify({ step: "done", failures })}`)
  await window.happyDOM.close()
}

process.exit(failures.length === 0 ? 0 : 1)
