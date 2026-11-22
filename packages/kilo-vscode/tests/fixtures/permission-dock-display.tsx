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
// a global. Static imports cannot express that ordering.
const { render } = await import("solid-js/web")
const { SessionContext } = await import("../../webview-ui/src/context/session")
const { LanguageContext } = await import("../../webview-ui/src/context/language")
const { ConfigContext } = await import("../../webview-ui/src/context/config")
const { PermissionDock } = await import("../../webview-ui/src/components/chat/PermissionDock")
const { resolveTemplate } = await import("../../webview-ui/src/context/language-utils")

const labels: Record<string, string> = {
  "ui.permission.toolLabel.read": "Read",
  "ui.permission.toolLabel.globSearch": "Glob Search",
  "ui.permission.toolLabel.externalDirectory": "Access External Directory",
}
const language = { t: (key: string, params?: Record<string, string>) => resolveTemplate(labels[key] ?? key, params) }
const config = { config: () => ({ permission: {} }) }
Object.defineProperty(document, "hasFocus", { value: () => true })

// U+202E is the sample format character: it must reach the card as the literal text "\u202e".
const RAW = "\u202E"
const ESCAPED = "\\u202e"

const base = { id: "permission-1", sessionID: "session-1", patterns: ["*"], always: ["*"] }

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
  // Happy DOM has no layout; make the mounted dock visible to its shortcut listener.
  Object.defineProperty(dock, "getClientRects", { value: () => [{ width: 800, height: 400 }] })
  return { root, dispose }
}

function text(root: Element, selector: string) {
  const node = root.querySelector(selector)
  assert(node, `Missing surface: ${selector}`)
  return node.textContent ?? ""
}

function escaped(value: string, surface: string) {
  assert(value.includes(ESCAPED), `${surface} lost the escaped control: ${JSON.stringify(value)}`)
  assert(!value.includes(RAW), `${surface} showed the raw control: ${JSON.stringify(value)}`)
}

function check(request: PermissionRequest, run: (root: Element) => void) {
  const shown = mount(request)
  try {
    run(shown.root)
  } finally {
    shown.dispose()
    shown.root.remove()
  }
}

// Description hint from args.description.
check({ ...base, toolName: "bash", args: { command: "echo hi", description: `runs ${RAW}harmless.sh` } }, (root) => {
  const hint = text(root, '[data-slot="permission-hint"]')
  assert.equal(hint, "runs \\u202eharmless.sh")
  escaped(hint, "Description hint")
})

// Ordinary command keeps its line breaks and escapes the control.
check({ ...base, toolName: "bash", args: { command: `echo start\nprintf ${RAW}x\n` } }, (root) => {
  const code = text(root, '[data-slot="permission-command-code"]')
  assert(code.startsWith("echo start\nprintf "))
  assert(code.endsWith("\n"), "Command lost its trailing newline")
  escaped(code, "Ordinary command")
})

// Every pattern path in a multi-pattern request.
check({ ...base, toolName: "read", patterns: ["src/app.ts", `src/${RAW}gnp.exe`], args: {} }, (root) => {
  const paths = Array.from(root.querySelectorAll('[data-slot="permission-pattern"]'), (node) => node.textContent)
  assert.deepEqual(paths, ["src/app.ts", "src/\\u202egnp.exe"])
  escaped(paths.join("\n"), "Pattern paths")
})

// Single pattern hint.
check({ ...base, toolName: "glob", patterns: [`src/**/${RAW}gnp.exe`], args: {} }, (root) => {
  const hint = text(root, '[data-slot="permission-hint"]')
  assert.equal(hint, "Glob Search src/**/\\u202egnp.exe")
  escaped(hint, "Single pattern hint")
})

// External-directory rule path.
check(
  {
    ...base,
    toolName: "external_directory",
    patterns: [`/tmp/${RAW}gnp.d/`],
    always: [`/tmp/${RAW}gnp.d/*`],
    args: {},
  },
  (root) => {
    assert(root.querySelector('[data-slot="permission-rules-section"]'), "Expected the rules section to render")
    const rule = text(root, '[data-slot="permission-rule-path"]')
    assert(rule.includes("/tmp/"))
    escaped(rule, "External directory rule path")
  },
)

// MCP input block keeps its JSON line breaks and escapes the control.
check({ ...base, toolName: "acme_lookup", args: { mcpInput: { query: `name${RAW}exe` } } }, (root) => {
  const code = text(root, '[data-slot="permission-input-code"]')
  assert(code.includes('"query": "name\\u202eexe"'))
  assert(code.includes("\n"), "MCP input lost its JSON line breaks")
  escaped(code, "MCP input")
})

// An unknown tool has no label key, so its own name is shown.
check({ ...base, toolName: `acme_${RAW}lookup`, patterns: [`src/${RAW}gnp.exe`], args: {} }, (root) => {
  const hint = text(root, '[data-slot="permission-hint"]')
  assert.equal(hint, "acme_\\u202elookup src/\\u202egnp.exe")
  escaped(hint, "Unknown tool label")
})

await window.happyDOM.close()
