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

const request: PermissionRequest = {
  id: "permission-1",
  sessionID: "session-1",
  toolName: "edit",
  patterns: ["demo.txt"],
  always: ["*"],
  args: {},
}
const session = { currentSessionID: () => request.sessionID }
const language = { t: (key: string) => key }
const config = { config: () => ({ permission: { edit: { "*": "allow" } } }) }
Object.defineProperty(document, "hasFocus", { value: () => true })

for (const mode of ["reject", "once", "approve", "deny", "keyboard"] as const) {
  const root = document.createElement("div")
  document.body.append(root)
  const calls: Array<{ response: string; approved: string[]; denied: string[]; feedback?: string }> = []
  const dispose = render(
    () => (
      <SessionContext.Provider value={session as never}>
        <LanguageContext.Provider value={language as never}>
          <ConfigContext.Provider value={config as never}>
            <PermissionDock
              request={request}
              responding={false}
              onDecide={(_id, response, approved, denied, feedback) => {
                calls.push({ response, approved, denied, feedback })
              }}
            />
          </ConfigContext.Provider>
        </LanguageContext.Provider>
      </SessionContext.Provider>
    ),
    root,
  )
  const dock = root.querySelector('[data-component="permission-shortcuts"]')
  assert(dock)
  // Happy DOM has no layout; make the mounted dock visible to its shortcut listener.
  Object.defineProperty(dock, "getClientRects", { value: () => [{ width: 800, height: 400 }] })
  const enter = () =>
    document.body.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))
  const click = (selector: string) => {
    const button = root.querySelector<HTMLButtonElement>(selector)
    assert(button, `Missing button: ${selector}`)
    button.click()
  }
  try {
    assert.equal(root.querySelector('[data-slot="permission-rule-row"]')?.getAttribute("data-decision"), "approved")
    if (mode === "approve") {
      click('[aria-label="ui.permission.rule.removeFromAllowed"]')
      assert.equal(root.querySelector('[data-slot="permission-rule-row"]')?.getAttribute("data-decision"), "pending")
      click('[aria-label="ui.permission.rule.addToAllowed"]')
    }
    if (mode === "deny") click('[aria-label="ui.permission.rule.addToDenied"]')
    if (mode === "once") {
      enter()
    }
    if (mode !== "once") {
      click('[data-slot="permission-actions"] button:last-child')
      assert.equal(calls.length, 0, "Opening feedback must not submit a response")
      const input = root.querySelector<HTMLTextAreaElement>('[data-slot="permission-feedback-input"]')
      assert(input)
      input.value = "Use spaces, not tabs"
      input.dispatchEvent(new window.Event("input", { bubbles: true }))
      if (mode === "keyboard") {
        input.blur()
        enter()
        assert.equal(calls.length, 0, "Global Enter must not approve while rejection feedback is open")
        assert(root.querySelector('[data-slot="permission-feedback-input"]'))
      }
      click('[data-slot="permission-reject-confirm"]')
    }
    assert.deepEqual(calls, [
      {
        response: mode === "once" ? "once" : "reject",
        approved: mode === "approve" ? ["*"] : [],
        denied: mode === "deny" ? ["*"] : [],
        feedback: mode === "once" ? undefined : "Use spaces, not tabs",
      },
    ])
  } finally {
    dispose()
    root.remove()
  }
}
await window.happyDOM.close()
