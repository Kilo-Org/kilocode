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
const { post } = await import("../../webview-ui/src/utils/webview-message")

const settle = async () => {
  await Promise.resolve()
  await window.happyDOM.waitUntilComplete()
}

const node = () => document.querySelector('[data-testid="probe-dialog"]')

// The probe below hands its dialog API back here, so the assertions drive the same stack the
// provider context closes.
const ui: { value?: { open: () => void; active: () => boolean } } = {}
const probe = () => {
  if (!ui.value) throw new Error("the probe dialog has not rendered")
  return ui.value
}

/**
 * Opens one dialog from inside the real DialogProvider, so the assertion can ask whether the
 * provider context closed it.
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
        <ProviderProvider>
          <Probe />
        </ProviderProvider>
      </DialogProvider>
    </VSCodeProvider>
  ),
  host,
)

try {
  await settle()
  await settle()
  console.log(`RESULT ${JSON.stringify({ step: "open on mount", node: !!node(), active: probe().active() })}`)
  check("the probe dialog is open after mount", () => {
    assert.ok(node(), "the probe dialog is rendered")
    assert.ok(probe().active(), "the dialog stack holds the probe dialog")
  })

  // A project change closes an open dialog, because the dialog belongs to the project it was
  // opened for. close() drops the stack entry after its 100 ms timer, so wait for that timer.
  post({ type: "providersReset" })
  await settle()
  await new Promise((resolve) => setTimeout(resolve, 150))
  await settle()
  console.log(`RESULT ${JSON.stringify({ step: "after reset", node: !!node(), active: probe().active() })}`)
  check("providersReset closes the open dialog", () => {
    assert.ok(!node(), "no probe dialog remains in the document")
    assert.equal(probe().active(), false, "the dialog stack is empty")
  })

  // The loading message only drops catalog rows; it must leave an open dialog alone.
  probe().open()
  await settle()
  assert.ok(node(), "the probe dialog is open again")
  post({ type: "providersLoading" })
  await settle()
  await new Promise((resolve) => setTimeout(resolve, 150))
  await settle()
  console.log(`RESULT ${JSON.stringify({ step: "after loading", node: !!node(), active: probe().active() })}`)
  check("providersLoading keeps the open dialog", () => {
    assert.ok(node(), "the probe dialog is still rendered")
    assert.ok(probe().active(), "the dialog stack still holds the probe dialog")
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
