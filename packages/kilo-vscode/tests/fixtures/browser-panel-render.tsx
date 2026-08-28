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
  HTMLInputElement: window.HTMLInputElement,
  HTMLButtonElement: window.HTMLButtonElement,
  SVGElement: window.SVGElement,
  MutationObserver: window.MutationObserver,
  ResizeObserver: window.ResizeObserver,
  Event: window.Event,
  MouseEvent: window.MouseEvent,
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
})

const { createSignal } = await import("solid-js")
const { render } = await import("solid-js/web")
const { BrowserPanel } = await import("../../webview-ui/browser")
import type { BrowserCommand, BrowserEvent, BrowserLabels } from "../../webview-ui/browser/types"
import type { BrowserReference } from "../../src/shared/browser-feedback"

const root = document.createElement("div")
document.body.append(root)
const scope = { sessionId: "standalone", projectId: "fixture" }
const sent: BrowserCommand[] = []
const references: BrowserReference[] = []
let receive: ((event: BrowserEvent) => void) | undefined
let closed = 0
const [labels, update] = createSignal<BrowserLabels>({
  title: "Browser",
  url: "Address",
  urlPlaceholder: "Local URL",
  open: "Go",
  refresh: "Reload",
  close: "Close",
  inspect: "Select element",
  devtoolsTitle: "Developer tools",
  empty: "Open a local page",
  noSession: "Choose a session",
  screenshotAlt: "Preview",
  errors: (count) => `${count} errors`,
})
const dispose = render(
  () => (
    <BrowserPanel
      scope={() => scope}
      labels={labels()}
      theme={() => "light"}
      transport={{
        send: (command) => sent.push(command),
        subscribe: (handler) => {
          receive = handler
          return () => {
            receive = undefined
          }
        },
      }}
      onReference={(reference) => references.push(reference)}
      onClose={() => closed++}
    />
  ),
  root,
)
assert.deepEqual(sent[0], { type: "state", scope })
const state = { scope, browserId: "browser", status: "ready" as const, errors: 0, url: "about:blank" }
receive?.({ type: "state", value: state })
await window.happyDOM.waitUntilComplete()
const frame = root.querySelector(".am-browser-frame")
assert.ok(frame)
receive?.({ type: "state", value: { ...state, logs: ["[info] Updated"] } })
assert.equal(root.querySelector(".am-browser-frame"), frame)
;(root.querySelector("button[aria-label=Reload]") as HTMLButtonElement).click()
assert.deepEqual(sent.at(-1), { type: "refresh", scope })
receive?.({ type: "state", value: { ...state, navigation: 1 } })
await window.happyDOM.waitUntilComplete()
assert.equal(frame.isConnected, false)
const refreshed = root.querySelector(".am-browser-frame")
assert.ok(refreshed)
assert.equal(refreshed.getAttribute("src"), state.url)
assert.equal(refreshed.getAttribute("sandbox"), "allow-scripts allow-forms allow-same-origin")
receive?.({ type: "state", value: { ...state, navigation: 1, errors: 1 } })
assert.equal(root.querySelector(".am-browser-frame"), refreshed)
assert.equal(root.querySelectorAll("button[aria-label=Close]").length, 1)
;(root.querySelector("button[aria-label='Select element']") as HTMLButtonElement).click()
const overlay = root.querySelector(".am-browser-inspect") as HTMLButtonElement
assert.ok(overlay)
overlay.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 200 }) as DOMRect
overlay.dispatchEvent(new window.MouseEvent("click", { bubbles: true, clientX: 200, clientY: 100 }))
const request = sent.at(-1)
assert.equal(request?.type, "inspect")
if (request?.type !== "inspect") throw new Error("Selection command was not emitted")
receive?.({
  type: "inspection",
  value: { scope, requestId: request.requestId, hover: false, logs: [], element: { tag: "button", selector: "#save" } },
})
assert.equal(references[0]?.selector, "#save")
update((value) => ({ ...value, close: "Fermer" }))
await window.happyDOM.waitUntilComplete()
assert.ok(root.querySelector("button[aria-label=Fermer]"))
;(root.querySelector(".am-browser-tools-action button") as HTMLButtonElement).click()
assert.deepEqual(sent.at(-1), { type: "devtools", scope, theme: "light" })
;(root.querySelector("button[aria-label=Fermer]") as HTMLButtonElement).click()
assert.equal(closed, 1)
assert.deepEqual(sent.at(-1), { type: "close", scope })
dispose()
assert.equal(receive, undefined)
await window.happyDOM.close()
