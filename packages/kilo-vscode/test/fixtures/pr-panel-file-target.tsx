// A PR panel on a worktree with no session tab must still open the file from that worktree, and a session in another
// folder must not win over the PR worktree. The sessionId prop is deliberately still passed: older code read it, and
// the panel must ignore it.
import assert from "node:assert/strict"
import { Window } from "happy-dom"

const window = new Window({ url: "http://localhost" })
Object.defineProperty(window, "origin", { configurable: true, value: "http://localhost" })
Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  HTMLInputElement: window.HTMLInputElement,
  HTMLTextAreaElement: window.HTMLTextAreaElement,
  HTMLButtonElement: window.HTMLButtonElement,
  SVGElement: window.SVGElement,
  MutationObserver: window.MutationObserver,
  ResizeObserver: window.ResizeObserver,
  IntersectionObserver: window.IntersectionObserver,
  Event: window.Event,
  CustomEvent: window.CustomEvent,
  MouseEvent: window.MouseEvent,
  MessageEvent: window.MessageEvent,
  FileReader: window.FileReader,
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
})
Object.assign(globalThis, { getComputedStyle: window.getComputedStyle.bind(window) })

const posted: Array<Record<string, unknown>> = []
Object.assign(globalThis, {
  acquireVsCodeApi: () => ({
    postMessage: (message: Record<string, unknown>) => posted.push(message),
    getState: () => undefined,
    setState: () => undefined,
  }),
})

const { render } = await import("solid-js/web")
const { VSCodeProvider } = await import("../../webview-ui/src/context/vscode")
const { PRPanelHost } = await import("../../webview-ui/agent-manager/pr/PRPanelHost")

const root = document.createElement("div")
document.body.append(root)
render(
  () => (
    <VSCodeProvider>
      <PRPanelHost
        pr={{
          number: 7,
          title: "Fixture PR",
          url: "https://github.com/fixture/repo/pull/7",
          state: "open",
          review: null,
          checks: { status: "none", total: 0, passed: 0, failed: 0, pending: 0, checks: [] },
          reviewers: [],
          additions: 1,
          deletions: 1,
          files: 1,
        }}
        worktreeId="wt-feature"
        sessionId="ses-elsewhere"
        onClose={() => undefined}
      />
    </VSCodeProvider>
  ),
  root,
)

const message = posted.find((item) => item.type === "agentManager.openFile")
assert.ok(message, "the PR panel sends an open-file message")
assert.equal(message["sessionId"], "wt-feature")
assert.equal(message["filePath"], "src/hello.ts")
assert.equal(message["line"], 2)
process.exit(0)
