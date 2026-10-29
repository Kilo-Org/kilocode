import assert from "node:assert/strict"
import { Window } from "happy-dom"
import type { HooksConfig } from "../../webview-ui/src/types/messages"

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
  acquireVsCodeApi: () => ({ postMessage() {}, getState: () => undefined, setState() {} }),
})

const { render } = await import("solid-js/web")
const { DialogProvider } = await import("@kilocode/kilo-ui/context/dialog")
const { VSCodeProvider } = await import("../../webview-ui/src/context/vscode")
const { LanguageContext } = await import("../../webview-ui/src/context/language")
const { ConfigContext } = await import("../../webview-ui/src/context/config")
const { default: HooksTab } = await import("../../webview-ui/src/components/settings/agent-behaviour/HooksTab")

const own: HooksConfig = {
  // `if` is only evaluated on tool events: the CLI skips the first two, so each shows the warning.
  Stop: [{ hooks: [{ type: "command", command: "notify.sh", if: "Bash(*)" }] }],
  UserPromptSubmit: [{ hooks: [{ type: "command", command: "prompt.sh", if: "Bash(*)" }] }],
  PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "guard.sh", if: "Bash(rm *)" }] }],
  PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "plain.sh" }] }],
}
const language = { t: (key: string) => key }
const config = {
  config: () => ({ hooks: own }),
  globalConfig: () => ({ hooks: own }),
  savedGlobalConfig: () => ({ hooks: own }),
  updateGlobalConfig: () => {},
}

const root = document.createElement("div")
document.body.append(root)
const dispose = render(
  () => (
    <VSCodeProvider>
      <LanguageContext.Provider value={language as never}>
        <ConfigContext.Provider value={config as never}>
          <DialogProvider>
            <HooksTab claude={false} />
          </DialogProvider>
        </ConfigContext.Provider>
      </LanguageContext.Provider>
    </VSCodeProvider>
  ),
  root,
)
try {
  const rows = [...root.querySelectorAll("span")].filter((item) => item.getAttribute("title")?.endsWith(".sh"))
  assert.equal(rows.length, 4)
  const warned = (command: string) => {
    const row = rows.find((item) => item.getAttribute("title") === command)?.closest("div[style*='cursor']")
    assert(row, command)
    return row.textContent?.includes("settings.agentBehaviour.hooks.ifIgnored")
  }
  assert.equal(warned("notify.sh"), true, "if on Stop")
  assert.equal(warned("prompt.sh"), true, "if on UserPromptSubmit")
  assert.equal(warned("guard.sh"), false, "if on PreToolUse is evaluated")
  assert.equal(warned("plain.sh"), false, "no if")
} finally {
  dispose()
  root.remove()
  await window.happyDOM.close()
}
