import assert from "node:assert/strict"
import { Window } from "happy-dom"
import type { PermissionRequest } from "../../webview-ui/src/types/messages"

const window = new Window()
Object.assign(globalThis, {
  window,
  document: window.document,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  SVGElement: window.SVGElement,
  customElements: window.customElements,
  Event: window.Event,
  MutationObserver: window.MutationObserver,
  getComputedStyle: window.getComputedStyle.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
})

const { render } = await import("solid-js/web")
const { SessionContext } = await import("../../webview-ui/src/context/session")
const { LanguageContext } = await import("../../webview-ui/src/context/language")
const { ConfigContext } = await import("../../webview-ui/src/context/config")
const { PermissionDock } = await import("../../webview-ui/src/components/chat/PermissionDock")

const language = { t: (key: string) => key }
const config = { config: () => ({ permission: {} }) }
Object.defineProperty(document, "hasFocus", { value: () => true })

function mount(request: PermissionRequest) {
  const root = document.createElement("div")
  document.body.append(root)
  const session = { currentSessionID: () => request.sessionID }
  const dispose = render(
    () => (
      <SessionContext.Provider value={session as never}>
        <LanguageContext.Provider value={language as never}>
          <ConfigContext.Provider value={config as never}>
            <PermissionDock request={request} responding={false} onDecide={() => {}} />
          </ConfigContext.Provider>
        </LanguageContext.Provider>
      </SessionContext.Provider>
    ),
    root,
  )
  const dock = root.querySelector('[data-component="permission-shortcuts"]')
  assert(dock)
  Object.defineProperty(dock, "getClientRects", { value: () => [{ width: 800, height: 400 }] })
  return { root, dispose }
}

const request: PermissionRequest = {
  id: "permission-1",
  sessionID: "session-1",
  toolName: "cagcode_find_symbol",
  patterns: ["*"],
  always: ["*"],
  args: { input: { symbol: "foo", nested: { a: [1, 2] } } },
}
const shown = mount(request)
try {
  const code = shown.root.querySelector('[data-slot="permission-input-code"]')
  assert(code, "Expected the pending input to be rendered")
  const json = code.textContent ?? ""
  assert(json.includes('"symbol": "foo"'), `Missing symbol in ${json}`)
  assert(json.includes('"nested"'), `Missing nested object in ${json}`)
  assert(json.includes('"a": ['), `Missing nested array in ${json}`)
  assert.equal(
    shown.root.querySelector('[data-slot="permission-input-label"]')?.textContent,
    "ui.messagePart.mcp.input",
  )
} finally {
  shown.dispose()
  shown.root.remove()
}

const hidden = mount({ ...request, args: { input: {} } })
try {
  assert.equal(hidden.root.querySelector('[data-slot="permission-input"]'), null)
} finally {
  hidden.dispose()
  hidden.root.remove()
}

await window.happyDOM.close()
