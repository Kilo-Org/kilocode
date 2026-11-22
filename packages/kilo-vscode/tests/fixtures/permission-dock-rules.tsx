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

// Webview modules read `window` at import time, so they load only after happy-dom is installed as
// a global. Static imports hoist above that assignment, so the signal factory loads here too.
const { render } = await import("solid-js/web")
const { createSignal } = await import("solid-js")
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

// Every case runs with a known home directory, so a home-prefixed entry resolves to it.
const home = { homeDir: () => "/home/me" }

// The same rule saved in the global config: the dock can delete it.
const savedAllow = {
  ...home,
  config: () => ({ permission: { edit: { "*": "allow" } } }),
  globalConfig: () => ({ permission: { edit: { "*": "allow" } } }),
  mergedGlobalConfig: () => ({ permission: { edit: { "*": "allow" } } }),
  workspaceConfig: () => ({ permission: {} }),
}
const savedDeny = {
  ...home,
  config: () => ({ permission: { edit: { "*": "deny" } } }),
  globalConfig: () => ({ permission: { edit: { "*": "deny" } } }),
  mergedGlobalConfig: () => ({ permission: { edit: { "*": "deny" } } }),
  workspaceConfig: () => ({ permission: {} }),
}
// A rule that another config scope supplies.
const workspaceAllow = {
  ...home,
  config: () => ({ permission: { edit: { "*": "allow" } } }),
  globalConfig: () => ({ permission: {} }),
  mergedGlobalConfig: () => ({ permission: {} }),
  workspaceConfig: () => ({ permission: { edit: { "*": "allow" } } }),
}
// A workspace-supplied deny row, so the indicator's state wording is covered in
// both directions.
const workspaceDeny = {
  ...home,
  config: () => ({ permission: { edit: { "*": "deny" } } }),
  globalConfig: () => ({ permission: {} }),
  mergedGlobalConfig: () => ({ permission: {} }),
  workspaceConfig: () => ({ permission: { edit: { "*": "deny" } } }),
}
// Both scopes save the same allow for the row.
const bothAllow = {
  ...home,
  config: () => ({ permission: { edit: { "*": "allow" } } }),
  globalConfig: () => ({ permission: { edit: { "*": "allow" } } }),
  mergedGlobalConfig: () => ({ permission: { edit: { "*": "allow" } } }),
  workspaceConfig: () => ({ permission: { edit: { "*": "allow" } } }),
}
// The primary global file holds the row, and a broader entry of the same merged scope
// supplies the same action, so the broader entry decides the pattern.
const broaderAllow = {
  ...home,
  config: () => ({ permission: { edit: { "edit *": "allow" } } }),
  globalConfig: () => ({ permission: { edit: { "edit *": "allow" } } }),
  mergedGlobalConfig: () => ({ permission: { edit: { "*": "allow", "edit *": "allow" } } }),
  workspaceConfig: () => ({ permission: {} }),
}
const broaderRequest: PermissionRequest = { ...request, always: ["edit *"] }
// The merged global scope supplies the wildcard row from a lower global file, so the row
// carries a state indicator.
const otherFileAllow = {
  ...home,
  config: () => ({ permission: { edit: { "*": "allow" } } }),
  globalConfig: () => ({ permission: {} }),
  mergedGlobalConfig: () => ({ permission: { edit: { "*": "allow" } } }),
  workspaceConfig: () => ({ permission: {} }),
}
// The merged global scope supplies a named row from a lower global file; a named
// pattern is removable from every file that holds it, so the row keeps its controls.
const namedOtherFileAllow = {
  ...home,
  config: () => ({ permission: { edit: { "edit *": "allow" } } }),
  globalConfig: () => ({ permission: {} }),
  mergedGlobalConfig: () => ({ permission: { edit: { "edit *": "allow" } } }),
  workspaceConfig: () => ({ permission: {} }),
}
// All three scopes save the row, and the workspace also holds a home-prefixed entry that
// resolves above the row, so the workspace supplies it.
const homeWorkspaceRequest: PermissionRequest = {
  ...request,
  toolName: "edit",
  always: ["/home/me/notes.md"],
  args: {},
}
const homeWorkspace = {
  ...home,
  config: () => ({ permission: { edit: { "/home/me/notes.md": "allow" } } }),
  globalConfig: () => ({ permission: { edit: { "/home/me/notes.md": "allow" } } }),
  mergedGlobalConfig: () => ({ permission: { edit: { "/home/me/notes.md": "allow" } } }),
  workspaceConfig: () => ({ permission: { edit: { "/home/me/notes.md": "allow", "~/*": "allow" } } }),
}
// The same entry with no home directory to resolve it: it may decide the row once the
// rules run, so the row keeps its indicator.
const homeUnknown = {
  ...home,
  homeDir: () => undefined,
  config: homeWorkspace.config,
  globalConfig: homeWorkspace.globalConfig,
  mergedGlobalConfig: homeWorkspace.mergedGlobalConfig,
  workspaceConfig: () => ({ permission: { edit: { "~/*": "allow" } } }),
}
type Mode =
  | "reject"
  | "once"
  | "approve"
  | "deny"
  | "keyboard"
  | "remove"
  | "removeDenied"
  | "undoDeny"
  | "workspace"
  | "both"
  | "workspaceDeny"
  | "broader"
  | "otherFile"
  | "namedOtherFile"
  | "homeWorkspace"
  | "homeUnknown"
type Call = { response: string; approved: string[]; denied: string[]; removed: string[]; feedback?: string }

// The dock reads `homeDir` beside the four config scopes, and the unresolved-prefix case
// passes an unknown directory instead of the shared one.
type Ctx = Omit<typeof savedAllow, "homeDir"> & { homeDir: () => string | undefined }

const cases: Array<{ mode: Mode; ctx: Ctx; request?: PermissionRequest }> = [
  { mode: "reject", ctx: savedAllow },
  { mode: "once", ctx: savedAllow },
  { mode: "approve", ctx: savedAllow },
  { mode: "deny", ctx: savedAllow },
  { mode: "keyboard", ctx: savedAllow },
  { mode: "remove", ctx: savedAllow },
  { mode: "removeDenied", ctx: savedDeny },
  { mode: "undoDeny", ctx: savedAllow },
  { mode: "workspace", ctx: workspaceAllow },
  { mode: "both", ctx: bothAllow },
  { mode: "workspaceDeny", ctx: workspaceDeny },
  { mode: "broader", ctx: broaderAllow, request: broaderRequest },
  { mode: "otherFile", ctx: otherFileAllow },
  { mode: "namedOtherFile", ctx: namedOtherFileAllow, request: broaderRequest },
  { mode: "homeWorkspace", ctx: homeWorkspace, request: homeWorkspaceRequest },
  { mode: "homeUnknown", ctx: homeUnknown, request: homeWorkspaceRequest },
]

for (const item of cases) {
  const { mode, ctx } = item
  const root = document.createElement("div")
  document.body.append(root)
  const calls: Call[] = []
  const dispose = render(
    () => (
      <SessionContext.Provider value={session as never}>
        <LanguageContext.Provider value={language as never}>
          <ConfigContext.Provider value={ctx as never}>
            <PermissionDock
              request={item.request ?? request}
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
    const plain = [
      "once",
      "remove",
      "removeDenied",
      "undoDeny",
      "workspace",
      "both",
      "workspaceDeny",
      "broader",
      "otherFile",
      "namedOtherFile",
      "homeWorkspace",
      "homeUnknown",
    ].includes(mode)
    const denied = mode === "removeDenied" || mode === "workspaceDeny"
    assert.equal(row()?.getAttribute("data-decision"), denied ? "denied" : "approved")

    if (
      mode === "workspace" ||
      mode === "both" ||
      mode === "workspaceDeny" ||
      mode === "broader" ||
      mode === "otherFile" ||
      mode === "homeWorkspace" ||
      mode === "homeUnknown"
    ) {
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
    if (mode === "undoDeny") {
      click('[aria-label="ui.permission.rule.addToDenied"]')
      assert.equal(row()?.getAttribute("data-decision"), "denied")
      click('[aria-label="ui.permission.rule.removeFromDenied"]')
      assert.equal(row()?.getAttribute("data-decision"), "approved")
      enter()
    }
    if (mode === "namedOtherFile") {
      // The row keeps its controls, and switching the saved rule off sends its removal.
      assert.equal(row()?.getAttribute("data-source"), null)
      click('[aria-label="ui.permission.rule.removeFromAllowed"]')
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
        removed: mode === "namedOtherFile" ? ["edit *"] : mode === "remove" || mode === "removeDenied" ? ["*"] : [],
        feedback: plain ? undefined : "Use spaces, not tabs",
      },
    ])
  } finally {
    dispose()
    root.remove()
  }
}

// A prompt can mount before the first config payload arrives. The row states follow the
// config accessors, so the row starts with its live controls and switches to the state
// indicator when the payload lands, without mounting again.
{
  const [live, setLive] = createSignal<Record<string, unknown>>({})
  const ctx = {
    config: () => live(),
    globalConfig: () => live(),
    mergedGlobalConfig: () => live(),
    workspaceConfig: () => live(),
    homeDir: () => "/home/me",
  }
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
  const row = () => root.querySelector('[data-slot="permission-rule-row"]')
  try {
    assert.equal(row()?.getAttribute("data-decision"), "pending")
    assert.equal(row()?.getAttribute("data-source"), null)
    assert(root.querySelector('[data-slot="permission-rule-toggle"]'))

    setLive({ permission: { edit: { "*": "allow" } } })

    assert.equal(row()?.getAttribute("data-decision"), "approved")
    assert.equal(row()?.getAttribute("data-source"), "config")
    assert.equal(root.querySelector('[data-slot="permission-rule-toggle"]'), null)
    assert.equal(root.querySelector('[aria-label="ui.permission.rule.removeFromAllowed"]'), null)
    // The state indicator names the saved action the config payload carries.
    assert.equal(
      root.querySelector('[data-slot="permission-rule-source"]')?.getAttribute("aria-label"),
      "settings.autoApprove.level.allow \u2014 ui.permission.rule.fromConfig",
    )
    // Answering a row the config now supplies sends no removal request.
    document.body.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))
    assert.deepEqual(calls, [{ response: "once", approved: [], denied: [], removed: [], feedback: undefined }])
  } finally {
    dispose()
    root.remove()
  }
}
await window.happyDOM.close()
