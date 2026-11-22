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
Object.defineProperty(document, "hasFocus", { value: () => true })

// The same rule saved in the global config: the dock can delete it.
const savedAllow = {
  config: () => ({ permission: { edit: { "*": "allow" } } }),
  globalConfig: () => ({ permission: { edit: { "*": "allow" } } }),
  workspaceConfig: () => ({ permission: {} }),
}
const savedDeny = {
  config: () => ({ permission: { edit: { "*": "deny" } } }),
  globalConfig: () => ({ permission: { edit: { "*": "deny" } } }),
  workspaceConfig: () => ({ permission: {} }),
}
// A rule that another config scope supplies.
const workspaceAllow = {
  config: () => ({ permission: { edit: { "*": "allow" } } }),
  globalConfig: () => ({ permission: {} }),
  workspaceConfig: () => ({ permission: { edit: { "*": "allow" } } }),
}
// A workspace-supplied deny row, so the indicator's state wording is covered in
// both directions.
const workspaceDeny = {
  config: () => ({ permission: { edit: { "*": "deny" } } }),
  globalConfig: () => ({ permission: {} }),
  workspaceConfig: () => ({ permission: { edit: { "*": "deny" } } }),
}
// Both scopes save the same allow for the row.
const bothAllow = {
  config: () => ({ permission: { edit: { "*": "allow" } } }),
  globalConfig: () => ({ permission: { edit: { "*": "allow" } } }),
  workspaceConfig: () => ({ permission: { edit: { "*": "allow" } } }),
}

type Mode =
  | "reject"
  | "once"
  | "approve"
  | "deny"
  | "keyboard"
  | "remove"
  | "removeDenied"
  | "workspace"
  | "both"
  | "workspaceDeny"
type Call = { response: string; approved: string[]; denied: string[]; removed: string[]; feedback?: string }

const cases: Array<{ mode: Mode; ctx: typeof savedAllow }> = [
  { mode: "reject", ctx: savedAllow },
  { mode: "once", ctx: savedAllow },
  { mode: "approve", ctx: savedAllow },
  { mode: "deny", ctx: savedAllow },
  { mode: "keyboard", ctx: savedAllow },
  { mode: "remove", ctx: savedAllow },
  { mode: "removeDenied", ctx: savedDeny },
  { mode: "workspace", ctx: workspaceAllow },
  { mode: "both", ctx: bothAllow },
  { mode: "workspaceDeny", ctx: workspaceDeny },
]

for (const { mode, ctx } of cases) {
  const root = document.createElement("div")
  document.body.append(root)
  const calls: Call[] = []
  const dispose = render(
    () => (
      <SessionContext.Provider value={session as never}>
        <LanguageContext.Provider value={language as never}>
          <ConfigContext.Provider value={ctx as never}>
            <PermissionDock
              request={request}
              responding={false}
              onDecide={(_id, response, approved, denied, removed, feedback) => {
                calls.push({ response, approved, denied, removed, feedback })
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
  const row = () => root.querySelector('[data-slot="permission-rule-row"]')
  try {
    // Removing a saved rule and answering without feedback are the plain paths.
    const plain = ["once", "remove", "removeDenied", "workspace", "both", "workspaceDeny"].includes(mode)
    const denied = mode === "removeDenied" || mode === "workspaceDeny"
    assert.equal(row()?.getAttribute("data-decision"), denied ? "denied" : "approved")

    if (mode === "workspace" || mode === "both" || mode === "workspaceDeny") {
      // A rule another scope supplies, shown with a state indicator.
      assert.equal(row()?.getAttribute("data-source"), "config")
      assert.equal(root.querySelector('[aria-label="ui.permission.rule.removeFromAllowed"]'), null)
      assert.equal(root.querySelector('[data-slot="permission-rule-toggle"]'), null)
      // The state indicator names the state as well, so assistive tech announces
      // whether the saved rule allows or denies.
      assert.equal(
        root.querySelector('[data-slot="permission-rule-source"]')?.getAttribute("aria-label"),
        `settings.autoApprove.level.${mode === "workspaceDeny" ? "deny" : "allow"} \u2014 ui.permission.rule.fromConfig`,
      )
      enter()
    }
    if (mode === "approve") {
      click('[aria-label="ui.permission.rule.removeFromAllowed"]')
      assert.equal(row()?.getAttribute("data-decision"), "pending")
      click('[aria-label="ui.permission.rule.addToAllowed"]')
    }
    if (mode === "deny") click('[aria-label="ui.permission.rule.addToDenied"]')
    if (mode === "remove") {
      click('[aria-label="ui.permission.rule.removeFromAllowed"]')
      assert.equal(row()?.getAttribute("data-decision"), "pending")
      enter()
    }
    if (mode === "removeDenied") {
      click('[aria-label="ui.permission.rule.removeFromDenied"]')
      assert.equal(row()?.getAttribute("data-decision"), "pending")
      enter()
    }
    if (mode === "once") enter()

    if (!plain) {
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
        response: plain ? "once" : "reject",
        approved: mode === "approve" ? ["*"] : [],
        denied: mode === "deny" ? ["*"] : [],
        removed: mode === "remove" || mode === "removeDenied" ? ["*"] : [],
        feedback: plain ? undefined : "Use spaces, not tabs",
      },
    ])
  } finally {
    dispose()
    root.remove()
  }
}
await window.happyDOM.close()
