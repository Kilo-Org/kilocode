// The settings search field shares the rail with the tab list as in v1. Kobalte's list owns the focus of its whole
// subtree: the first focus entry into the list pulls focus to the selected tab trigger, which made the search need a
// second click and made Tab skip the field. These assertions pin the v1 placement and the field's own focus.
import assert from "node:assert/strict"
import { Window } from "happy-dom"

const window = new Window({ url: "http://localhost" })
// The webview message guard compares the event origin with the window origin, and happy-dom's Window does not
// expose `origin` on its own.
Object.defineProperty(window, "origin", { configurable: true, value: "http://localhost" })
Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  Node: window.Node,
  NodeList: window.NodeList,
  NodeFilter: window.NodeFilter,
  HTMLCollection: window.HTMLCollection,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  HTMLDivElement: window.HTMLDivElement,
  HTMLSpanElement: window.HTMLSpanElement,
  HTMLInputElement: window.HTMLInputElement,
  HTMLTextAreaElement: window.HTMLTextAreaElement,
  HTMLButtonElement: window.HTMLButtonElement,
  SVGElement: window.SVGElement,
  Text: window.Text,
  Comment: window.Comment,
  Event: window.Event,
  CustomEvent: window.CustomEvent,
  MouseEvent: window.MouseEvent,
  PointerEvent: window.PointerEvent,
  KeyboardEvent: window.KeyboardEvent,
  MessageEvent: window.MessageEvent,
  MutationObserver: window.MutationObserver,
  ResizeObserver: window.ResizeObserver,
  IntersectionObserver: window.IntersectionObserver,
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  getComputedStyle: window.getComputedStyle.bind(window),
})
Object.assign(globalThis, {
  acquireVsCodeApi: () => ({
    postMessage: () => undefined,
    getState: () => undefined,
    setState: () => undefined,
  }),
})

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const { render } = await import("solid-js/web")
const { VSCodeProvider } = await import("../../webview-ui/src/context/vscode")
const { LanguageProvider } = await import("../../webview-ui/src/context/language")
const { V2Scope } = await import("../../webview-ui/src/v2/client")
const { SettingsConfigProvider } = await import("../../webview-ui/src/v2/settings-config")
const { default: Settings } = await import("../../webview-ui/src/components/settings/Settings")

// The data layer the settings shell reads: the config resource and the connection status. The active tab is About,
// which only reads the connection and the versions, so the rest of the settings handle stays empty.
const scope = {
  connection: { status: () => "connected", error: () => undefined },
  report: () => undefined,
  directory: "/settings",
  version: "0.0.0",
  extensionVersion: "0.0.0",
  open: () => undefined,
  data: { location: { config: { list: () => [], sync: async () => undefined } } },
} as never

const settings = {
  connection: () => "connected",
  connectionError: () => undefined,
  version: () => "0.0.0",
  extensionVersion: () => "0.0.0",
  open: () => undefined,
  reload: async () => undefined,
} as never

const root = document.createElement("div")
document.body.append(root)
const dispose = render(
  () => (
    <VSCodeProvider>
      <LanguageProvider>
        <V2Scope value={scope}>
          <SettingsConfigProvider>
            <Settings settings={settings} onLogin={() => undefined} tab="aboutKiloCode" />
          </SettingsConfigProvider>
        </V2Scope>
      </LanguageProvider>
    </VSCodeProvider>
  ),
  root,
)

const input = root.querySelector<HTMLInputElement>('[data-component="settings-search"] input')!
const box = root.querySelector<HTMLElement>('[data-slot="settings-search-box"]')!
const list = root.querySelector<HTMLElement>('[role="tablist"]')!
await wait(0)

assert.ok(input, "the settings search input renders")
assert.ok(list, "the settings tab list renders")

// v1 keeps the field at the top of the rail, inside the tab list. The placement is intentional; the fix is that the
// list's collection focus handling must not take the field's focus.
assert.equal(input.closest('[role="tablist"]'), list, "the search field renders at the top of the rail")

// A click focuses the field while the tab list is unfocused. Kobalte's list would take that focus for the selected
// tab trigger on the first entry, which needed a second click.
const trigger = list.querySelector<HTMLElement>('[data-slot="tabs-trigger"][tabindex="0"]')!
assert.ok(trigger, "the selected tab trigger is in the tab stop")
;(document.activeElement as HTMLElement | null)?.blur()
input.focus()
await wait(20)
assert.equal(document.activeElement, input, "the first focus entry stays on the search field")

// The box is padding around the field: a pointer down on the icon or the padding focuses the input.
;(document.activeElement as HTMLElement | null)?.blur()
const icon = box.querySelector<HTMLElement>('[data-component="icon"]')!
icon.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }))
await wait(0)
assert.equal(document.activeElement, input, "a pointer down on the box padding focuses the search field")

// A pointer down on the input keeps the browser's caret placement, so the handler leaves it alone.
const inField = new PointerEvent("pointerdown", { bubbles: true, cancelable: true })
input.dispatchEvent(inField)
assert.equal(inField.defaultPrevented, false, "a pointer down on the input keeps native caret placement")
assert.equal(document.activeElement, input, "a pointer down on the input keeps the focus")

// A pointer down on the clear button keeps its own click: it clears the query and returns focus to the field.
input.value = "disp"
input.dispatchEvent(new Event("input", { bubbles: true }))
await wait(0)
const clear = box.querySelector<HTMLButtonElement>("button")!
assert.ok(clear, "the clear button renders while the query is set")
const onClear = new PointerEvent("pointerdown", { bubbles: true, cancelable: true })
clear.dispatchEvent(onClear)
assert.equal(onClear.defaultPrevented, false, "a pointer down on the clear button keeps its click")
clear.dispatchEvent(new MouseEvent("click", { bubbles: true }))
await wait(0)
assert.equal(input.value, "", "the clear button clears the query")
assert.equal(document.activeElement, input, "the clear button returns focus to the field")

// Tab moves on from the field to the next stop of the rail. happy-dom does not run sequential focus navigation, so
// this walks the tabbable elements in document order: the header actions, the field, then the selected tab.
const tabbable = [...root.querySelectorAll<HTMLElement>('button, input, textarea, select, a[href], [tabindex]')].filter(
  (element) => element.tabIndex >= 0 && !element.hasAttribute("disabled"),
)
const index = tabbable.indexOf(input)
assert.ok(index > 0, "a control precedes the search field in the tab order")
assert.equal(tabbable[index - 1]?.closest('[role="tablist"]'), null, "Tab reaches the field after the header actions")
assert.equal(tabbable[index + 1], trigger, "Tab leaves the field for the selected tab")

const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })
input.dispatchEvent(tab)
assert.equal(tab.defaultPrevented, false, "the search does not swallow Tab")

dispose()
root.remove()
await window.happyDOM.close()
