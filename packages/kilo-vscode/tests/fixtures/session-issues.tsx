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
  // Solid's Portal checks `instanceof HTMLHeadElement`; without it the menu
  // content silently fails to mount.
  HTMLHeadElement: window.HTMLHeadElement,
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

  // The menu is one level: a group label per issue, its actions as direct
  // items, and a separator between issues. Submenus are deliberately absent.
  // Kobalte opens menus from `pointerdown`, so a bare click() would not.
  trigger.dispatchEvent(
    new window.PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, pointerType: "mouse" }),
  )
  await window.happyDOM.waitUntilComplete()
  assert.equal(trigger.getAttribute("aria-expanded"), "true", "trigger opens the issues menu")
  const menu = document.querySelector('[data-component="dropdown-menu-content"]')
  assert.ok(menu, "menu content renders when opened")
  assert.ok(menu.classList.contains("prompt-issues-menu"), "menu carries the native-menu style hook")
  assert.equal(document.querySelectorAll('[data-slot="dropdown-menu-sub-trigger"]').length, 0, "no submenus")
  assert.equal(document.querySelectorAll('[data-slot="dropdown-menu-group-label"]').length, 2, "one label per issue")
  assert.equal(document.querySelectorAll('[data-slot="dropdown-menu-separator"]').length, 1, "divided issues")
  assert.equal(document.querySelectorAll('[data-slot="dropdown-menu-item"]').length, 4, "two actions per issue")
  // The busy server's sign-in action is the only disabled row.
  assert.equal(document.querySelectorAll('[data-slot="dropdown-menu-item"][data-disabled]').length, 1, "busy disabled")

  assert.deepEqual(errors, [])
} finally {
  dispose()
  await window.happyDOM.close()
}
