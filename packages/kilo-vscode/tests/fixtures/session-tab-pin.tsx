import assert from "node:assert/strict"
import { Window } from "happy-dom"

const window = new Window({ url: "http://localhost" })
const style = window.getComputedStyle.bind(window)
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
  FocusEvent: window.FocusEvent,
  InputEvent: window.InputEvent,
  KeyboardEvent: window.KeyboardEvent,
  MouseEvent: window.MouseEvent,
  PointerEvent: window.PointerEvent,
  getComputedStyle: (node: Element) => {
    const value = style(node)
    Object.defineProperty(value, "animationName", { configurable: true, value: "none" })
    return value
  },
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
})

const { render } = await import("solid-js/web")
const { LanguageContext } = await import("../../webview-ui/src/context/language")
const { SessionTab } = await import("../../webview-ui/src/components/chat/SessionTab")

const calls: string[] = []
const language = {
  locale: () => "en" as const,
  setLocale: () => {},
  userOverride: () => "" as const,
  t: (key: string) => key,
}

const root = document.createElement("div")
document.body.append(root)

const tab = (toggle?: () => void) => (
  <SessionTab
    title="Alpha"
    active={false}
    state="idle"
    stateLabel="Idle"
    closeTitle="Close"
    closeLabel="Close"
    role="tab"
    selected={false}
    tabIndex={0}
    onSelect={() => calls.push("select")}
    onClose={() => {}}
    onTogglePin={toggle}
  />
)

const dispose = render(
  () => (
    <LanguageContext.Provider value={language}>
      {tab(() => calls.push("pin"))}
      {tab()}
    </LanguageContext.Provider>
  ),
  root,
)

const targets = root.querySelectorAll<HTMLElement>(".am-tab-target")
assert.equal(targets.length, 2, "expected two session tabs")

const click = (node: HTMLElement, shiftKey: boolean) =>
  node.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey }))

click(targets[0]!, false)
assert.deepEqual(calls, ["select"], "plain click should select")

calls.length = 0
click(targets[0]!, true)
assert.deepEqual(calls, ["pin"], "shift click should toggle the pin")

calls.length = 0
click(targets[1]!, true)
assert.deepEqual(calls, ["select"], "shift click without a pin action should select")

dispose()
