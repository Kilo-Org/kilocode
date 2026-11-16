// Renders a real Agent Manager terminal tab and moves the visible tab away from it. The tab stays mounted, so its
// `aria-selected` and `tabIndex` must follow the visible tab instead of the value captured at render time.
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
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  HTMLInputElement: window.HTMLInputElement,
  HTMLTextAreaElement: window.HTMLTextAreaElement,
  HTMLButtonElement: window.HTMLButtonElement,
  SVGElement: window.SVGElement,
  MutationObserver: window.MutationObserver,
  ResizeObserver: window.ResizeObserver,
  IntersectionObserver: window.IntersectionObserver,
  Event: window.Event,
  CustomEvent: window.CustomEvent,
  MouseEvent: window.MouseEvent,
  MessageEvent: window.MessageEvent,
  FileReader: window.FileReader,
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
})
// The composer reads theme variables through getComputedStyle while its module loads.
Object.assign(globalThis, { getComputedStyle: window.getComputedStyle.bind(window) })

Object.assign(globalThis, {
  acquireVsCodeApi: () => ({
    postMessage: () => undefined,
    getState: () => undefined,
    setState: () => undefined,
  }),
})

const { render } = await import("solid-js/web")
const { createSignal, For } = await import("solid-js")
const { DragDropProvider, DragDropSensors, SortableProvider } = await import("@thisbeyond/solid-dnd")
const { VSCodeProvider } = await import("../../webview-ui/src/context/vscode")
const { LanguageProvider } = await import("../../webview-ui/src/context/language")
const { renderTab } = await import("../../webview-ui/agent-manager/tab-rendering")
const { createTerminalState } = await import("../../webview-ui/agent-manager/terminal/state")

const terms = createTerminalState(() => "local")
terms.add(null, { id: "terminal:one", title: "Terminal", font: { fontFamily: "monospace", fontSize: 12 }, placement: "tab" })
const [visible, setVisible] = createSignal<string | undefined>("terminal:one")
const noop = () => undefined
const deps = {
  terms,
  REVIEW_TAB_ID: "review",
  tabIds: () => ["terminal:one", "pending:two"],
  kb: () => ({}),
  reviewActive: () => false,
  currentSessionID: () => undefined,
  activePendingId: () => "pending:two",
  visibleTabId: visible,
  isPending: (id: string) => id.startsWith("pending:"),
  activityFor: () => undefined,
  stateLabel: () => "",
  tabLookup: () => new Map(),
  adjacentHint: () => "",
  activateTerminal: noop,
  deactivateTerminal: noop,
  closeTerminal: noop,
  terminalMiddleClick: noop,
  closeReview: noop,
  reviewMiddleClick: noop,
  selectReviewTab: noop,
  selectSessionTab: noop,
  sessionMiddleClick: noop,
  sessionClose: noop,
  sessionFork: noop,
  isPinned: () => false,
  togglePinned: noop,
  onTabKey: noop,
  reviewLabel: "Review",
  reviewTooltip: "Review",
} as never

const root = document.createElement("div")
document.body.append(root)
render(
  () => (
    <VSCodeProvider>
      <LanguageProvider>
        <DragDropProvider>
          <DragDropSensors />
          <SortableProvider ids={["terminal:one"]}>
            {/* Like the tab bar: the entry renders once per id and stays mounted. */}
            <For each={["terminal:one"]}>{(id) => renderTab(id, deps)}</For>
          </SortableProvider>
        </DragDropProvider>
      </LanguageProvider>
    </VSCodeProvider>
  ),
  root,
)

const tab = () => root.querySelector('[data-tab-id="terminal:one"] [role="tab"]')
assert.ok(tab(), "terminal tab rendered")
assert.equal(tab()!.getAttribute("aria-selected"), "true")
assert.equal(tab()!.getAttribute("tabindex"), "0")

const mounted = tab()
setVisible("pending:two")
assert.equal(tab(), mounted, "the tab stays mounted")
assert.equal(tab()!.getAttribute("aria-selected"), "false")
assert.equal(tab()!.getAttribute("tabindex"), "-1")
process.exit(0)
