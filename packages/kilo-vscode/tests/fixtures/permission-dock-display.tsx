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

// Invisible format characters on the same surfaces: zero width space in a path, zero width joiner
// in a description. Each shows its literal escape and never the raw character.
const ZWSP = "\u200b"
check({ ...base, toolName: "read", patterns: ["src/app.ts", `readme${ZWSP}.exe`], args: {} }, (root) => {
  const paths = Array.from(root.querySelectorAll('[data-slot="permission-pattern"]'), (node) => node.textContent)
  assert.deepEqual(paths, ["src/app.ts", "readme\\u200b.exe"])
  assert(paths.join("\n").includes("\\u200b"), "Pattern paths lost the escaped invisible character")
  assert(!paths.join("\n").includes(ZWSP), "Pattern paths showed the raw invisible character")
})

const ZWJ = "\u200d"
check({ ...base, toolName: "bash", args: { command: "echo hi", description: `runs readme${ZWJ}.sh` } }, (root) => {
  const hint = text(root, '[data-slot="permission-hint"]')
  assert.equal(hint, "runs readme\\u200d.sh")
  assert(hint.includes("\\u200d"), `Description hint lost the escaped invisible character: ${JSON.stringify(hint)}`)
  assert(!hint.includes(ZWJ), `Description hint showed the raw invisible character: ${JSON.stringify(hint)}`)
})

// Width-less format characters from other planes on the same surfaces: a tag character in the
// description and a variation selector in a pattern path. Each shows its literal escape.
const TAG = "\u{E0041}"
const VS = "\uFE0F"
check(
  {
    ...base,
    toolName: "read",
    patterns: ["src/app.ts", `src/${VS}gnp.exe`],
    args: { description: `runs ${TAG}harmless.sh` },
  },
  (root) => {
    const hint = text(root, '[data-slot="permission-hint"]')
    assert.equal(hint, "runs \\u{e0041}harmless.sh")
    assert(hint.includes("\\u{e0041}"), `Description hint lost the escaped tag character: ${JSON.stringify(hint)}`)
    assert(!hint.includes(TAG), `Description hint showed the raw tag character: ${JSON.stringify(hint)}`)
    const paths = Array.from(root.querySelectorAll('[data-slot="permission-pattern"]'), (node) => node.textContent)
    assert.deepEqual(paths, ["src/app.ts", "src/\\ufe0fgnp.exe"])
    assert(paths.join("\n").includes("\\ufe0f"), "Pattern paths lost the escaped variation selector")
    assert(!paths.join("\n").includes(VS), "Pattern paths showed the raw variation selector")
  },
)

// Default-ignorable characters on the same surfaces: the shorthand format control U+1BCA0 in a
// pattern path and the combining grapheme joiner U+034F in a description. Each shows its literal
// escape and never the raw character.
const SHORTHAND = "\u{1BCA0}"
const CGJ = "\u034F"
check(
  {
    ...base,
    toolName: "read",
    patterns: ["src/app.ts", `src/${SHORTHAND}gnp.exe`],
    args: { description: `runs ${CGJ}harmless.sh` },
  },
  (root) => {
    const hint = text(root, '[data-slot="permission-hint"]')
    assert.equal(hint, "runs \\u034fharmless.sh")
    assert(hint.includes("\\u034f"), `Description hint lost the escaped format control: ${JSON.stringify(hint)}`)
    assert(!hint.includes(CGJ), `Description hint showed the raw format control: ${JSON.stringify(hint)}`)
    const paths = Array.from(root.querySelectorAll('[data-slot="permission-pattern"]'), (node) => node.textContent)
    assert.deepEqual(paths, ["src/app.ts", "src/\\u{1bca0}gnp.exe"])
    assert(paths.join("\n").includes("\\u{1bca0}"), "Pattern paths lost the escaped shorthand format control")
    assert(!paths.join("\n").includes(SHORTHAND), "Pattern paths showed the raw shorthand format control")
  },
)

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

// A bash rule label is model-supplied too. Its rows sit in the collapsed rules section, so open it.
check({ ...base, toolName: "bash", args: { command: "echo hi", rules: [`git log ${RAW} *`] } }, (root) => {
  const header = root.querySelector('[data-slot="permission-rules-header"]')
  assert(header, "Expected the rules header to render")
  header.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
  const rule = text(root, '[data-slot="permission-rule"]')
  assert(rule.includes(ESCAPED), `Bash rule label lost the escaped control: ${JSON.stringify(rule)}`)
  assert(!rule.includes(RAW), `Bash rule label showed the raw control: ${JSON.stringify(rule)}`)
})

// Capture what the copy button writes, so a copy keeps the request's own bytes.
const copied: string[] = []
Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  value: { writeText: (value: string) => copied.push(value) },
})

async function copy(root: Element) {
  const button = root.querySelector('[data-slot="permission-command-copy"]')
  assert(button, "Missing the copy button")
  button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
  await Promise.resolve()
  assert.equal(copied.length, 1, "The copy button wrote nothing")
  return copied.pop()!
}

// A skill-shell command gets the same IDN normalization as the ordinary command, and copies raw.
const skillCmd = `curl https://\u0430pitest.com/status\u2026`
{
  const shown = mount({
    ...base,
    toolName: "bash",
    args: { skillShell: true, skill: "check", commands: [skillCmd] },
  })
  try {
    const code = text(shown.root, '[data-slot="permission-command-code"]')
    assert(code.includes("xn--pitest-2nf.com"), `Skill-shell command kept the Unicode host: ${JSON.stringify(code)}`)
    assert(!code.includes("\u0430"), "Skill-shell command showed the Unicode host")
    assert.equal(await copy(shown.root), skillCmd, "Skill-shell copy did not return the request's bytes")
  } finally {
    shown.dispose()
    shown.root.remove()
  }
}

// The ordinary command normalizes its Unicode host for display and copies the original bytes.
const rawCmd = `curl https://\u0430pitest.com/status\nprintf '${RAW}x'\tls`
{
  const shown = mount({ ...base, toolName: "bash", args: { command: rawCmd } })
  try {
    const code = text(shown.root, '[data-slot="permission-command-code"]')
    assert(code.includes("xn--pitest-2nf.com"), `Ordinary command kept the Unicode host: ${JSON.stringify(code)}`)
    assert(code.includes(ESCAPED), `Ordinary command lost the escaped control: ${JSON.stringify(code)}`)
    assert(code.includes("\\t"), `Ordinary command lost the escaped tab: ${JSON.stringify(code)}`)
    assert(!code.includes(RAW) && !code.includes("\u0430"), "Ordinary command showed raw request bytes")
    assert.equal(await copy(shown.root), rawCmd, "Ordinary copy did not return the request's bytes")
  } finally {
    shown.dispose()
    shown.root.remove()
  }
}

await window.happyDOM.close()
