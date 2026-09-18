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
const { createRoot, createSignal } = await import("solid-js")
const { createPermissionResponses } = await import("../../webview-ui/src/context/permission-response")
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
for (const mode of ["submitting", "unknown", "failed"] as const) {
  const root = document.createElement("div")
  document.body.append(root)
  const decisions: string[] = []
  const checks: string[] = []
  const dispose = render(
    () => (
      <SessionContext.Provider value={{ ...session, checkPermissionStatus: (id: string) => checks.push(id) } as never}>
        <LanguageContext.Provider value={language as never}>
          <ConfigContext.Provider value={config as never}>
            <PermissionDock
              request={{ ...request, responseError: mode === "submitting" ? undefined : mode }}
              responding={mode === "submitting"}
              onDecide={(_id, response) => decisions.push(response)}
            />
          </ConfigContext.Provider>
        </LanguageContext.Provider>
      </SessionContext.Provider>
    ),
    root,
  )
  try {
    const dock = root.querySelector('[data-component="permission-shortcuts"]')!
    Object.defineProperty(dock, "getClientRects", { value: () => [{ width: 800, height: 400 }] })
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('[data-slot="permission-actions"] button')]
    assert.equal(root.querySelector('[role="status"]')?.textContent, `ui.permission.${mode}`)
    if (mode === "unknown") {
      assert.equal(buttons.at(0)?.textContent, "ui.permission.checkStatus")
      buttons.at(0)!.click()
      assert.deepEqual(checks, [request.id])
    }
    for (const button of buttons.filter((button) => button.textContent !== "ui.permission.checkStatus")) {
      assert.equal(button.disabled, mode !== "failed")
    }
    document.body.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))
    assert.deepEqual(decisions, mode === "failed" ? ["once"] : [])
  } finally {
    dispose()
    root.remove()
  }
}
const expired: string[] = []
const posted: unknown[] = []
const state = createRoot((dispose) => {
  const [permissions, setPermissions] = createSignal<PermissionRequest[]>([request])
  const [responding, setResponding] = createSignal(new Set<string>())
  const responses = createPermissionResponses(
    {
      permissions,
      setPermissions,
      responding,
      setResponding,
      terminal: () => false,
      post: (message) => posted.push(message),
      expired: (id) => expired.push(id),
    },
    10,
  )
  return { responses, dispose, permissions, setPermissions, responding, setResponding }
})
try {
  assert.equal(state.responses.respond(request.id, "once", [], []), true)
  assert.equal(state.responses.respond(request.id, "once", [], []), false)
  await Bun.sleep(25)
  assert.deepEqual(expired, [request.id], "Missing completion must invoke recovery")
  state.setResponding(new Set())
  state.setPermissions([{ ...request, responseError: "unknown" }])
  assert.equal(state.responses.respond(request.id, "once", [], []), false)
  state.responses.check(request.id)
  assert.deepEqual(posted, [
    {
      type: "permissionResponse",
      permissionId: request.id,
      sessionID: request.sessionID,
      response: "once",
      approvedAlways: [],
      deniedAlways: [],
    },
    { type: "permissionStatus", permissionId: request.id, sessionID: request.sessionID },
  ])
  state.responses.clear(request.id)
  await Bun.sleep(25)
  assert.deepEqual(expired, [request.id], "A confirmed result must clear its watchdog")
  state.setResponding(new Set())
  state.responses.check(request.id)
  state.setPermissions([])
  await Bun.sleep(25)
  assert.deepEqual(expired, [request.id], "Removed permissions must clear their watchdog")
} finally {
  state.dispose()
}
await window.happyDOM.close()
