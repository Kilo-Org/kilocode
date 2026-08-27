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
  devtools: "Developer tools",
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
receive?.({ type: "state", value: { scope, browserId: "browser", status: "ready", errors: 0, url: "about:blank" } })
await window.happyDOM.waitUntilComplete()
assert.ok(root.querySelector("iframe"))
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
