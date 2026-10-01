import assert from "node:assert/strict"
import { Window } from "happy-dom"

const window = new Window({ url: "https://kilo.test" })
const errors: unknown[] = []
window.addEventListener("error", (event) => errors.push(event.error))
Object.defineProperty(window, "origin", { value: window.location.origin })
Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  HTMLElement: window.HTMLElement,
  HTMLButtonElement: window.HTMLButtonElement,
  CustomEvent: window.CustomEvent,
  MouseEvent: window.MouseEvent,
  Event: window.Event,
  Element: window.Element,
  SVGElement: window.SVGElement,
  Node: window.Node,
  NodeFilter: window.NodeFilter,
  MutationObserver: window.MutationObserver,
  ResizeObserver: window.ResizeObserver,
  IntersectionObserver: window.IntersectionObserver,
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  getComputedStyle: window.getComputedStyle.bind(window),
})

const { render } = await import("solid-js/web")
const { createSignal } = await import("solid-js")
const { VSCodeProvider } = await import("../../webview-ui/src/context/vscode")
const { LanguageProvider } = await import("../../webview-ui/src/context/language")
const { SessionIssues } = await import("../../webview-ui/src/components/chat/SessionIssues")
const { mcpAuthIssues } = await import("../../webview-ui/src/components/chat/session-issues")

Object.defineProperty(globalThis, "acquireVsCodeApi", {
  value: () => ({
    postMessage: () => {},
    getState: () => undefined,
    setState: () => {},
  }),
})

const signIns: string[] = []
const opens: string[] = []
const [needsAuth, setNeedsAuth] = createSignal<string[]>([])
const [busy, setBusy] = createSignal<string[]>([])

const root = document.createElement("div")
document.body.append(root)
const dispose = render(
  () => (
    <VSCodeProvider>
      <LanguageProvider>
        <SessionIssues
          issues={mcpAuthIssues(needsAuth(), busy(), (key, params) => key && JSON.stringify({ key, params }), {
            signIn: (name) => signIns.push(name),
            openSettings: (name) => opens.push(name),
          })}
        />
      </LanguageProvider>
    </VSCodeProvider>
  ),
  root,
)

try {
  await window.happyDOM.waitUntilComplete()
  assert.equal(document.querySelector('[data-slot="dropdown-menu-trigger"]'), null, "hidden with no issues")

  setNeedsAuth(["anaconda"])
  await window.happyDOM.waitUntilComplete()
  const trigger = document.querySelector<HTMLElement>('[data-slot="dropdown-menu-trigger"]')
  assert.ok(trigger, "trigger renders when there is an issue")
  assert.ok(trigger.getAttribute("aria-label"), "trigger has an aria-label")

  setNeedsAuth(["zebra", "anaconda"])
  setBusy(["zebra"])
  await window.happyDOM.waitUntilComplete()
  assert.equal(document.querySelectorAll('[data-slot="dropdown-menu-trigger"]').length, 1, "still a single trigger")

  assert.deepEqual(errors, [])
} finally {
  dispose()
  await window.happyDOM.close()
}
