import assert from "node:assert/strict"
import { Window } from "happy-dom"
import type { WebviewMessage } from "../../webview-ui/src/types/messages"

const window = new Window({ url: "http://localhost" })
const errors: unknown[] = []
window.addEventListener("error", (event) => errors.push(event.error))
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
  NodeFilter: window.NodeFilter,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  HTMLHeadElement: window.HTMLHeadElement,
  HTMLInputElement: window.HTMLInputElement,
  HTMLTextAreaElement: window.HTMLTextAreaElement,
  HTMLButtonElement: window.HTMLButtonElement,
  HTMLAnchorElement: window.HTMLAnchorElement,
  SVGElement: window.SVGElement,
  MouseEvent: window.MouseEvent,
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
const { onMount } = await import("solid-js")
const { DialogProvider, useDialog } = await import("@kilocode/kilo-ui/context/dialog")
const { VSCodeProvider } = await import("../../webview-ui/src/context/vscode")
const { ProviderProvider } = await import("../../webview-ui/src/context/provider")
const { ConfigProvider } = await import("../../webview-ui/src/context/config")
const { LanguageContext } = await import("../../webview-ui/src/context/language")
const { default: CustomProviderDialog } = await import("../../webview-ui/src/components/settings/CustomProviderDialog")
const { dict } = await import("../../webview-ui/src/i18n/en")
const { post } = await import("../../webview-ui/src/utils/webview-message")

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

const wait = async () => {
  // DialogProvider.close() drops its stack entry after a 100 ms timer.
  await settle()
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, 150)
  await promise
  await settle()
}

const node = () => document.querySelector('[data-testid="probe-dialog"]')
const providerNode = () => document.querySelector('[data-component="dialog"]')

// The probes below hand their dialog API back here, so the assertions drive the same stack the
// provider context closes.
const ui: { value?: { open: () => void; active: () => boolean } } = {}
const probe = () => {
  if (!ui.value) throw new Error("the probe dialog has not rendered")
  return ui.value
}

/**
 * Opens one plain dialog from inside the real DialogProvider, so the assertion can ask whether
 * the provider context closed it.
 */
const Probe = () => {
  const dialog = useDialog()
  ui.value = {
    open: () => dialog.show(() => <div data-testid="probe-dialog">open</div>),
    active: () => !!dialog.active,
  }
  onMount(() => ui.value?.open())
  return null
}

const providerUi: { value?: { open: () => void } } = {}

/**
 * Opens one real provider dialog, which belongs to the provider state of the project it was
 * opened for.
 */
const ProviderProbe = () => {
  const dialog = useDialog()
  providerUi.value = { open: () => dialog.show(() => <CustomProviderDialog />) }
  return null
}

const failures: string[] = []
const check = (step: string, body: () => void) => {
  try {
    body()
    console.log(`RESULT ${JSON.stringify({ step, ok: true })}`)
  } catch (error) {
    failures.push(`${step}: ${(error as Error).message}`)
  }
}

const host = document.createElement("div")
document.body.append(host)
const dispose = render(
  () => (
    <VSCodeProvider>
      <DialogProvider>
        <ConfigProvider>
          <LanguageContext.Provider value={language as never}>
            <ProviderProvider>
              <Probe />
              <ProviderProbe />
            </ProviderProvider>
          </LanguageContext.Provider>
        </ConfigProvider>
      </DialogProvider>
    </VSCodeProvider>
  ),
  host,
)

try {
  await settle()
  await settle()
  console.log(`RESULT ${JSON.stringify({ step: "open on mount", node: !!node(), active: probe().active() })}`)
  check("the plain probe dialog is open after mount", () => {
    assert.ok(node(), "the plain probe dialog is rendered")
    assert.ok(probe().active(), "the dialog stack holds the plain probe dialog")
  })

  // A project change only closes the provider dialogs that belong to the replaced project, so
  // an unrelated dialog stays open.
  post({ type: "providersReset" })
  await wait()
  console.log(
    `RESULT ${JSON.stringify({ step: "plain dialog after reset", node: !!node(), active: probe().active() })}`,
  )
  check("providersReset keeps a plain dialog open", () => {
    assert.ok(node(), "the plain probe dialog is still rendered")
    assert.ok(probe().active(), "the dialog stack still holds the plain probe dialog")
  })

  // A provider dialog belongs to the project it was opened for, because its component
  // registers with the provider context.
  providerUi.value?.open()
  await settle()
  console.log(`RESULT ${JSON.stringify({ step: "provider dialog open", node: !!providerNode() })}`)
  check("the provider dialog opens", () => {
    assert.ok(providerNode(), "the custom provider dialog is rendered")
  })

  post({ type: "providersReset" })
  await wait()
  console.log(
    `RESULT ${JSON.stringify({ step: "provider dialog after reset", node: !!providerNode(), plain: !!node() })}`,
  )
  check("providersReset closes the open provider dialog", () => {
    assert.equal(providerNode(), null, "no provider dialog remains in the document")
    assert.equal(probe().active(), false, "the dialog stack is empty")
    assert.equal(node(), null, "the plain probe dialog was already replaced by the provider dialog")
  })

  // The closed provider dialog unregistered itself, so a later project change must not close
  // an unrelated dialog again.
  probe().open()
  await settle()
  post({ type: "providersReset" })
  await wait()
  console.log(
    `RESULT ${JSON.stringify({ step: "plain dialog after a later reset", node: !!node(), active: probe().active() })}`,
  )
  check("the provider dialog registration does not outlive it", () => {
    assert.ok(node(), "the plain probe dialog is still rendered")
    assert.ok(probe().active(), "the dialog stack still holds the plain probe dialog")
  })

  // The loading message only drops catalog rows; it must leave an open dialog alone.
  post({ type: "providersLoading" })
  await wait()
  console.log(`RESULT ${JSON.stringify({ step: "after loading", node: !!node(), active: probe().active() })}`)
  check("providersLoading keeps the open dialog", () => {
    assert.ok(node(), "the plain probe dialog is still rendered")
    assert.ok(probe().active(), "the dialog stack still holds the plain probe dialog")
  })

  check("no window errors", () => {
    assert.deepEqual(errors, [])
  })
} finally {
  console.log(`RESULT ${JSON.stringify({ step: "done", failures })}`)
  dispose()
  host.remove()
  await window.happyDOM.close()
}

process.exit(failures.length === 0 ? 0 : 1)
