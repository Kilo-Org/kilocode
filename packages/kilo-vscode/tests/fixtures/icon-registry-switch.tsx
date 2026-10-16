import assert from "node:assert/strict"
import { Window } from "happy-dom"

const window = new Window({ url: "https://kilo.test" })
Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  HTMLElement: window.HTMLElement,
  Element: window.Element,
  Node: window.Node,
  SVGElement: window.SVGElement,
  MutationObserver: window.MutationObserver,
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  getComputedStyle: window.getComputedStyle.bind(window),
})
const { createSignal } = await import("solid-js")
const { render } = await import("solid-js/web")
const { Icon } = await import("@kilocode/kilo-ui/icon")

// PRBadge maps `failure` to a kilo-ui icon and `approved` to an upstream icon.
// Switching between the two registries after mount used to throw
// "Cannot read properties of undefined (reading 'viewBox')" and blank the sidebar.
const [name, setName] = createSignal<"circle-x-outline" | "circle-check">("circle-x-outline")
const root = document.createElement("div")
document.body.append(root)
const dispose = render(() => <Icon name={name()} size="small" />, root)
try {
  const svg = () => root.querySelector("svg[data-slot='icon-svg']")
  assert.equal(svg()?.getAttribute("viewBox"), "0 0 20 20")
  assert.match(svg()?.innerHTML ?? "", /<path/)
  setName("circle-check")
  assert.match(svg()?.innerHTML ?? "", /opencode-icon-circle-check/)
  setName("circle-x-outline")
  assert.match(svg()?.innerHTML ?? "", /<path/)
  assert.doesNotMatch(svg()?.innerHTML ?? "", /<use/)
} finally {
  dispose()
  await window.happyDOM.close()
}
