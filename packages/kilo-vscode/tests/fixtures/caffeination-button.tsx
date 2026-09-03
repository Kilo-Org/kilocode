import assert from "node:assert/strict"
import { Window } from "happy-dom"
import type { CaffeinationState } from "../../webview-ui/src/types/messages"

const window = new Window()
Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  HTMLElement: window.HTMLElement,
  Element: window.Element,
  Node: window.Node,
  MutationObserver: window.MutationObserver,
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  getComputedStyle: window.getComputedStyle.bind(window),
})

const { createSignal } = await import("solid-js")
const { render } = await import("solid-js/web")
const { CaffeinationButton } = await import("../../webview-ui/agent-manager/CaffeinationButton")
const [state, setState] = createSignal<CaffeinationState>({ enabled: false, active: false, available: true })
const clicks: boolean[] = []
const root = document.createElement("div")
document.body.append(root)
const dispose = render(
  () => <CaffeinationButton t={() => "Keep computer awake"} state={state} onToggle={() => clicks.push(true)} />,
  root,
)
try {
  const button = root.querySelector("button")
  assert(button)
  assert.equal(button.getAttribute("aria-label"), "Keep computer awake")
  assert.equal(button.getAttribute("aria-pressed"), "false")
  assert.equal(button.getAttribute("data-variant"), "ghost")
  assert.equal(button.disabled, false)

  setState({ enabled: false, active: true, available: false, error: "Cleanup failed" })
  assert.equal(button.getAttribute("aria-label"), "Cleanup failed")
  assert.equal(button.getAttribute("aria-pressed"), "true")
  assert.equal(button.getAttribute("data-variant"), "primary")
  assert.equal(button.disabled, false)
  assert.equal(button.tabIndex, 0)
  button.click()
  assert.deepEqual(clicks, [true])

  setState({ enabled: false, active: false, available: false })
  assert.equal(button.getAttribute("aria-pressed"), "false")
  assert.equal(button.disabled, true)
  button.click()
  assert.deepEqual(clicks, [true])
} finally {
  dispose()
  await window.happyDOM.close()
}
