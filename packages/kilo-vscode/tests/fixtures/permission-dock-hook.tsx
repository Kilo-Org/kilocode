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
const { createSignal } = await import("solid-js")
const { SessionContext } = await import("../../webview-ui/src/context/session")
const { LanguageContext } = await import("../../webview-ui/src/context/language")
const { ConfigContext } = await import("../../webview-ui/src/context/config")
const { PermissionDock } = await import("../../webview-ui/src/components/chat/PermissionDock")

const edit: PermissionRequest = {
  id: "permission-1",
  sessionID: "session-1",
  toolName: "edit",
  patterns: ["demo.txt"],
  always: ["*"],
  args: {},
}
// A forced prompt from a PreToolUse hook `ask`. The server sends no rules for it; `always` is set
// here anyway to check the dock never saves rules for a prompt that offers none.
const ask: PermissionRequest = {
  id: "permission-2",
  sessionID: "session-1",
  toolName: "bash",
  patterns: ["git push --force origin main"],
  always: ["git push *"],
  args: { hookAsk: true, reason: "  Force push‮ to main\u0007\nRewrites shared history.  " },
}
// A hook ask for a tool with no command or file: the server sends the tool and its arguments so the
// prompt can show what the hook asks about. Both hold model-written text, so both are shown escaped.
const tool: PermissionRequest = {
  id: "permission-4",
  sessionID: "session-1",
  toolName: "mcp__github__create_issue",
  patterns: ["*"],
  always: [],
  args: {
    hookAsk: true,
    reason: "Creates a public issue",
    tool: "mcp__github__create_issue‮\u0007",
    input: { title: "Bug‮ report", labels: ["a\u0007", 1] },
  },
}
const next: PermissionRequest = { ...edit, id: "permission-3", patterns: ["other.txt"] }
const session = { currentSessionID: () => edit.sessionID }
const language = { t: (key: string) => key }
const config = { config: () => ({ permission: {} }) }
Object.defineProperty(document, "hasFocus", { value: () => true })

// A rule toggled on one request never reaches the next request the same dock shows.
for (const target of [ask, tool, next]) {
  const root = document.createElement("div")
  document.body.append(root)
  const calls: Array<{ id: string; response: string; approved: string[]; denied: string[] }> = []
  const [request, setRequest] = createSignal(edit)
  const dispose = render(
    () => (
      <SessionContext.Provider value={session as never}>
        <LanguageContext.Provider value={language as never}>
          <ConfigContext.Provider value={config as never}>
            <PermissionDock
              request={request()}
              responding={false}
              onDecide={(id, response, approved, denied) => {
                calls.push({ id, response, approved, denied })
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
  try {
    const deny = root.querySelector<HTMLButtonElement>('[aria-label="ui.permission.rule.addToDenied"]')
    assert(deny, "The first request offers a rule")
    deny.click()
    assert.equal(root.querySelector('[data-slot="permission-rule-row"]')?.getAttribute("data-decision"), "denied")

    setRequest(target)
    if (target === ask) {
      assert.equal(
        root.querySelector('[data-slot="permission-header-title"]')?.textContent,
        "notification.permission.titleHookAsk",
      )
      assert.equal(root.querySelector('[data-slot="permission-rule-row"]'), null, "A hook ask offers no rules")
      // The reason is hook output: control and bidi characters are shown escaped, line breaks kept.
      assert.equal(
        root.querySelector("[data-hook-reason]")?.textContent,
        "Force push\\u202e to main\\x07\nRewrites shared history.",
      )
      // Older servers send neither the tool nor its arguments: nothing extra is shown.
      assert.equal(root.querySelector("[data-hook-tool]"), null)
      assert.equal(root.querySelector('[data-slot="permission-input"]'), null)
    }
    if (target === tool) {
      assert.equal(root.querySelector('[data-slot="permission-rule-row"]'), null, "A hook ask offers no rules")
      assert.equal(root.querySelector("[data-hook-tool]")?.textContent, "mcp__github__create_issue\\u202e\\x07")
      assert.equal(root.querySelector('[data-slot="permission-input-label"]')?.textContent, "ui.messagePart.mcp.input")
      assert.equal(
        root.querySelector('[data-slot="permission-input-code"]')?.textContent,
        ["{", '  "title": "Bug\\u202e report",', '  "labels": [', '    "a\\u0007",', "    1", "  ]", "}"].join("\n"),
      )
    }
    if (target === next) {
      assert.equal(root.querySelector('[data-slot="permission-rule-row"]')?.getAttribute("data-decision"), "pending")
    }
    enter()
    assert.deepEqual(calls, [{ id: target.id, response: "once", approved: [], denied: [] }])
  } finally {
    dispose()
    root.remove()
  }
}
await window.happyDOM.close()
