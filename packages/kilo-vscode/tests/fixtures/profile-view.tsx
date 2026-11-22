import assert from "node:assert/strict"
import { Window } from "happy-dom"
import type { ExtensionMessage, ProfileData, WebviewMessage } from "../../webview-ui/src/types/messages"

const window = new Window({ url: "https://kilo.test" })
Object.defineProperty(window, "origin", { value: window.location.origin })
Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  HTMLButtonElement: window.HTMLButtonElement,
  HTMLHeadElement: window.HTMLHeadElement,
  SVGElement: window.SVGElement,
  ShadowRoot: window.ShadowRoot,
  CustomEvent: window.CustomEvent,
  MessageEvent: window.MessageEvent,
  PointerEvent: window.PointerEvent,
  MouseEvent: window.MouseEvent,
  Event: window.Event,
  MutationObserver: window.MutationObserver,
  ResizeObserver: window.ResizeObserver,
  IntersectionObserver: window.IntersectionObserver,
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  getComputedStyle: window.getComputedStyle.bind(window),
})

const posted: WebviewMessage[] = []
Object.assign(globalThis, {
  acquireVsCodeApi: () => ({
    postMessage: (message: WebviewMessage) => posted.push(message),
    getState: () => undefined,
    setState: () => {},
  }),
})

// Providers must load after the browser globals above exist, so these modules
// cannot be static imports: they capture `window`/`document` at module scope.
const { render } = await import("solid-js/web")
const { VSCodeProvider } = await import("../../webview-ui/src/context/vscode")
const { useServer, ServerProvider } = await import("../../webview-ui/src/context/server")
const { LanguageProvider } = await import("../../webview-ui/src/context/language")
const { default: ProfileView } = await import("../../webview-ui/src/components/profile/ProfileView")
const { post } = await import("../../webview-ui/src/utils/webview-message")

/** Feeds the account the host pushed, so the component reads the real last-known profile. */
const View = () => {
  const server = useServer()
  return <ProfileView profileData={server.profileData()} deviceAuth={{ status: "idle" }} onLogin={() => {}} />
}

const root = document.createElement("div")
document.body.append(root)

const dispose = render(
  () => (
    <VSCodeProvider>
      <ServerProvider>
        <LanguageProvider>
          <View />
        </LanguageProvider>
      </ServerProvider>
    </VSCodeProvider>
  ),
  root,
)

const settle = () => window.happyDOM.waitUntilComplete()

const profile = (currentOrgId: string | null): ProfileData => ({
  profile: {
    email: "user@example.test",
    organizations: [
      { id: "org-1", name: "Org One", role: "admin" },
      { id: "org-2", name: "Org Two", role: "member" },
    ],
    hasPersonalAccount: false,
  },
  balance: null,
  kiloPass: null,
  currentOrgId,
})

const push = async (message: ExtensionMessage) => {
  post(message, window)
  await settle()
}

const trigger = () => {
  const node = root.querySelector<HTMLButtonElement>('[data-slot="select-select-trigger"]')
  assert(node, "the account selector was not rendered")
  return node
}

const option = (name: string) => {
  // Kobalte renders the listbox in a portal on document.body, outside the root.
  const found = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((node) =>
    node.textContent?.includes(name),
  )
  assert(found, `no option labelled ${name}`)
  return found
}

const press = async (node: HTMLElement) => {
  node.dispatchEvent(
    new window.PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, pointerType: "mouse" }),
  )
  node.dispatchEvent(
    new window.PointerEvent("pointerup", { bubbles: true, cancelable: true, button: 0, pointerType: "mouse" }),
  )
  await settle()
}

const open = async () => {
  await press(trigger())
  assert.equal(trigger().getAttribute("aria-expanded"), "true", "the selector must open")
}

const alert = () => root.querySelector('[role="alert"]')

const switchPosts = () => posted.filter((message) => message.type === "setOrganization")

interface SwitchRequest {
  type: "setOrganization"
  organizationId: string | null
  requestID: string
}

/** The single posted request, with its correlation id narrowed; a missing one is a failure. */
function switchPost(): SwitchRequest {
  const posts = switchPosts()
  const found = posts.at(-1)
  assert(found, "no switch request was posted")
  assert.equal(typeof found.requestID, "string", "the switch must carry a correlation id")
  assert.notEqual(found.requestID, "", "the switch must carry a non-empty correlation id")
  return { type: found.type, organizationId: found.organizationId ?? null, requestID: found.requestID }
}

try {
  // 1. The account selector shows the current organization and accepts picks.
  await push({ type: "profileData", data: profile("org-1") })
  assert.equal(trigger().disabled, false, "the selector starts enabled")
  assert.equal(trigger().textContent?.includes("Org One"), true, "the selector shows the current organization")
  await open()
  await press(option("Org Two"))
  const pending = switchPost()
  assert.equal(switchPosts().length, 1, "picking an account posts exactly one request")
  assert.equal(pending.organizationId, "org-2")
  assert.equal(trigger().disabled, true, "the selector is disabled while the attempt is pending")

  // 2. A stale result must not settle the attempt this component made.
  await push({
    type: "organizationSwitchResult",
    requestID: "not-this-request",
    organizationId: "org-2",
    ok: false,
    data: null,
    error: "stale",
  })
  assert.equal(trigger().disabled, true, "a result for another request must not settle the attempt")
  assert.equal(alert(), null, "a stale result must not surface a failure")

  // 3. The correlated failure clears the pending state and shows the failure text.
  await push({
    type: "organizationSwitchResult",
    requestID: pending.requestID,
    organizationId: "org-2",
    ok: false,
    data: null,
    error: "profile unavailable",
  })
  assert.equal(trigger().disabled, false, "a failed attempt must re-enable the selector")
  assert.equal(
    alert()?.textContent?.includes("Could not confirm the account switch."),
    true,
    "the failure text must be visible",
  )
  assert.equal(trigger().textContent?.includes("Org One"), true, "the last-known account stays in place")

  // The re-enabled selector is the retry path.
  await open()
  await press(option("Org Two"))
  const retried = switchPost()
  assert.equal(switchPosts().length, 2, "picking again posts a new request")
  assert.notEqual(retried.requestID, pending.requestID, "a retry must use a fresh request id")
  assert.equal(trigger().disabled, true)

  // A success clears the failure text without touching the pushed profile.
  await push({
    type: "organizationSwitchResult",
    requestID: retried.requestID,
    organizationId: "org-2",
    ok: true,
    data: profile("org-2"),
  })
  assert.equal(trigger().disabled, false, "a success must settle the attempt")
  assert.equal(alert(), null, "a success must clear the failure text")

  // Signing out ends any live attempt, so nothing returns after the next login.
  await open()
  await press(option("Org Two"))
  const abandoned = switchPost()
  assert.equal(trigger().disabled, true, "the attempt is pending before the session ends")
  await push({ type: "profileData", data: null })
  assert.equal(
    root.querySelector('[data-slot="select-select-trigger"]'),
    null,
    "signing out replaces the account card",
  )

  // A result for the abandoned request, and the next sign-in, must not revive it.
  await push({
    type: "organizationSwitchResult",
    requestID: abandoned.requestID,
    organizationId: "org-2",
    ok: false,
    data: null,
    error: "late",
  })
  await push({ type: "profileData", data: profile("org-1") })
  assert.equal(trigger().disabled, false, "the next session starts interactive")
  assert.equal(alert(), null, "the next session must not carry the previous failure")
} finally {
  dispose()
  root.remove()
  await window.happyDOM.close()
}
