import assert from "node:assert/strict"
import { Window } from "happy-dom"
import type { WebviewMessage } from "../../webview-ui/src/types/messages"

const window = new Window({ url: "https://kilo.test" })
Object.defineProperty(window, "origin", { value: window.location.origin })
Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  HTMLElement: window.HTMLElement,
  Element: window.Element,
  Node: window.Node,
  MessageEvent: window.MessageEvent,
  MutationObserver: window.MutationObserver,
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  getComputedStyle: window.getComputedStyle.bind(window),
})
const { render } = await import("solid-js/web")
const { post } = await import("../../webview-ui/src/utils/webview-message")
const { VSCodeProvider } = await import("../../webview-ui/src/context/vscode")
const { CaffeinationButton } = await import("../../webview-ui/agent-manager/CaffeinationButton")
const messages: WebviewMessage[] = []
Object.defineProperty(globalThis, "acquireVsCodeApi", {
  value: () => ({
    postMessage: (message: WebviewMessage) => {
      messages.push(message)
      if (message.type === "agentManager.requestCaffeination")
        post({ type: "agentManager.caffeination", enabled: false, active: false, available: true })
    },
    getState: () => undefined,
    setState: () => {},
  }),
})
const root = document.createElement("div")
document.body.append(root)
const dispose = render(
  () => (
    <VSCodeProvider>
      <CaffeinationButton t={() => "Keep computer awake while Kilo agents work"} />
    </VSCodeProvider>
  ),
  root,
)
try {
  await Promise.resolve()
  assert(messages.some((message) => message.type === "agentManager.requestCaffeination"))
  const button = root.querySelector("button")
  assert(button)
  assert.equal(button.getAttribute("aria-label"), "Keep computer awake while Kilo agents work")
  assert.equal(button.getAttribute("aria-pressed"), "false")
  assert.equal(button.disabled, false)
  assert.equal(button.getAttribute("data-icon"), "coffee")
  button.click()
  assert.deepEqual(messages.at(-1), { type: "agentManager.setCaffeination", enabled: true })
  post({ type: "agentManager.caffeination", enabled: true, active: false, available: true })
  assert.equal(button.getAttribute("data-icon"), "coffee")
  assert.equal(button.getAttribute("aria-pressed"), "true")
  post({ type: "agentManager.caffeination", enabled: false, active: true, available: false, error: "Cleanup failed" })
  assert.equal(button.getAttribute("data-icon"), "coffee")
  assert.equal(button.getAttribute("aria-pressed"), "true")
  assert.equal(button.disabled, false)
  button.click()
  assert.deepEqual(messages.at(-1), { type: "agentManager.setCaffeination", enabled: false })
  post({ type: "agentManager.caffeination", enabled: false, active: false, available: false })
  assert.equal(button.getAttribute("data-icon"), "coffee")
  assert.equal(button.disabled, true)
} finally {
  dispose()
  await window.happyDOM.close()
}
