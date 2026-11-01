import assert from "node:assert/strict"
import { Window } from "happy-dom"
import type { PermissionRequest } from "../../webview-ui/src/types/messages"
import { dict } from "../../webview-ui/src/i18n/fr"

const window = new Window()
Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  SVGElement: window.SVGElement,
  customElements: window.customElements,
  MutationObserver: window.MutationObserver,
  Event: window.Event,
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  getComputedStyle: window.getComputedStyle.bind(window),
})

const { render } = await import("solid-js/web")
const { SessionContext } = await import("../../webview-ui/src/context/session")
const { LanguageContext } = await import("../../webview-ui/src/context/language")
const { ConfigContext } = await import("../../webview-ui/src/context/config")
const { PermissionDock } = await import("../../webview-ui/src/components/chat/PermissionDock")

const session = { currentSessionID: () => "session" }
const language = { t: (key: string) => dict[key as keyof typeof dict] ?? key }
const config = { config: () => ({}) }

function check(tool: string, args: Record<string, unknown>, expected?: string) {
  const request: PermissionRequest = {
    id: "permission",
    sessionID: "session",
    toolName: tool,
    patterns: ["/outside/project/**"],
    always: [],
    args,
  }
  const calls: string[] = []
  const root = document.createElement("div")
  document.body.append(root)
  const dispose = render(
    () => (
      <SessionContext.Provider value={session as never}>
        <LanguageContext.Provider value={language as never}>
          <ConfigContext.Provider value={config as never}>
            <PermissionDock request={request} responding={false} onDecide={(_, response) => calls.push(response)} />
          </ConfigContext.Provider>
        </LanguageContext.Provider>
      </SessionContext.Provider>
    ),
    root,
  )
  try {
    const reason = root.querySelector('[data-slot="permission-reason"]')
    assert.equal(reason?.querySelector("em")?.textContent, expected, tool)
    if (expected) assert.equal(reason?.querySelector("span")?.textContent, `${dict["ui.permission.reason"]} `)
    if (!expected) assert.equal(reason, null)
    if (args.command)
      assert.ok(root.querySelector('[data-slot="permission-command"]')?.textContent?.includes(String(args.command)))
    if (!args.command && !args.commands) assert.ok(root.textContent?.includes("/outside/project/**"))
    const buttons = root.querySelectorAll<HTMLButtonElement>('[data-slot="permission-actions"] button')
    assert.equal(buttons.length, 2)
    buttons.item(0).click()
    buttons.item(1).click()
    const reject = root.querySelector<HTMLButtonElement>('[data-slot="permission-reject-confirm"]')
    assert(reject)
    reject.click()
    assert.deepEqual(calls, ["once", "reject"])
    return root.innerHTML
  } finally {
    dispose()
    root.remove()
  }
}

for (const tool of ["read", "external_directory", "bash"]) {
  const args = tool === "bash" ? { command: "git status", heredoc: true } : {}
  check(tool, { ...args, description: "  Inspect project state  " }, "Inspect project state")
  for (const description of [undefined, null, 42, {}, "", " \n\t "]) check(tool, { ...args, description })
}

for (const [tool, args] of [
  ["bash", { backgroundProcess: true, command: "git status", heredoc: true }],
  ["external_directory", { skillShell: true }],
  ["bash", { skillShell: true }],
  ["glob", {}],
] as const) {
  const html = check(tool, { ...args, description: "  Existing hint  " })
  assert.ok(html.includes('data-slot="permission-hint"') && html.includes("Existing hint"))
}
const batch = check("bash", { skillShell: true, commands: ["git status"], description: "Hidden batch hint" })
assert.ok(batch.includes("git status"))
assert.ok(!batch.includes("Hidden batch hint"))
