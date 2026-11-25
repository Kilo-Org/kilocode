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

const profile = (currentOrgId: string | null, hasPersonalAccount = false): ProfileData => ({
  profile: {
    email: "user@example.test",
    organizations: [
      { id: "org-1", name: "Org One", role: "admin" },
      { id: "org-2", name: "Org Two", role: "member" },
    ],
    hasPersonalAccount,
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

const retryButton = () => {
  const node = root.querySelector<HTMLButtonElement>(".profile-switch-retry")
  assert(node, "the retry control was not rendered")
  return node
}

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

  // The host pushes the refreshed profile before the correlated result. That push
  // must not unlock the selector, or a second pick would discard this attempt.
  await push({ type: "profileData", data: profile("org-2") })
  assert.equal(trigger().disabled, true, "a profile push must not unlock a pending attempt")
  assert.equal(switchPosts().length, 1, "a profile push must not post another request")
  await push({ type: "profileData", data: profile("org-1") })
  assert.equal(trigger().disabled, true, "the selector stays locked until the result arrives")

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
    alert()?.textContent?.includes("profile unavailable"),
    true,
    "the failure text must carry the concrete error",
  )
  assert.equal(trigger().textContent?.includes("Org One"), true, "the last-known account stays in place")

  // Retry re-posts the failed target with a fresh request id and goes pending again.
  retryButton().click()
  await settle()
  const retried = switchPost()
  assert.equal(switchPosts().length, 2, "Retry must post again")
  assert.equal(retried.organizationId, pending.organizationId, "Retry must target the same account")
  assert.notEqual(retried.requestID, pending.requestID, "Retry must use a fresh request id")
  assert.equal(trigger().disabled, true, "Retry must put the attempt back into pending")
  assert.equal(alert(), null, "Retry must clear the previous failure")

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

  // A result with no usable error falls back to the generic copy.
  await open()
  await press(option("Org Two"))
  const blank = switchPost()
  await push({
    type: "organizationSwitchResult",
    requestID: blank.requestID,
    organizationId: "org-2",
    ok: false,
    data: null,
    error: "",
  })
  assert.equal(
    alert()?.textContent?.includes("Could not confirm the account switch."),
    true,
    "an empty error must fall back to the generic failure text",
  )

  // A later profile read that shows the attempted account applied ends the
  // failed attempt, so no stale alert and no Retry for an applied switch remain.
  assert(alert(), "the failure is visible before the confirming read")
  await push({ type: "profileData", data: profile("org-2") })
  assert.equal(alert(), null, "a profile push that shows the target applied must clear the failure")
  assert.equal(trigger().disabled, false, "the selector stays interactive after the clear")

  // A push that still shows the account the attempt started from must leave the
  // failure in place.
  await push({ type: "profileData", data: profile("org-1") })
  await open()
  await press(option("Org Two"))
  const unconfirmed = switchPost()
  await push({
    type: "organizationSwitchResult",
    requestID: unconfirmed.requestID,
    organizationId: "org-2",
    ok: false,
    data: null,
    error: "profile unavailable",
  })
  await push({ type: "profileData", data: profile("org-1") })
  assert(alert(), "a push that still shows the origin must keep the failure")
  assert.equal(trigger().disabled, false, "the selector is interactive for the retry")

  // With no personal account, a profile whose currentOrgId is null is displayed
  // as its first organization, so an attempt that starts in that state starts
  // from the organization the selector shows rather than from personal. A push
  // that still reports currentOrgId: null leaves that displayed account alone,
  // so the failure and its Retry must stay.
  await push({ type: "profileData", data: profile(null) })
  assert.equal(trigger().textContent?.includes("Org One"), true, "the selector shows the first organization")
  await open()
  await press(option("Org Two"))
  const divergent = switchPost()
  await push({
    type: "organizationSwitchResult",
    requestID: divergent.requestID,
    organizationId: "org-2",
    ok: false,
    data: null,
    error: "profile unavailable",
  })
  assert(alert(), "the failure is visible before the unconfirming push")
  await push({ type: "profileData", data: profile(null) })
  assert(alert(), "a push that still shows the first organization must keep the failure")
  assert.equal(retryButton().isConnected, true, "the Retry stays available while the displayed account is unchanged")
  // Naming that same organization explicitly also leaves the displayed account
  // unchanged, so it keeps the failure too.
  await push({ type: "profileData", data: profile("org-1") })
  assert(alert(), "a push that names the same displayed organization must keep the failure")

  // A push that reports an account other than the one the attempt started from
  // was superseded by a switch made in the other surface, so it ends the
  // failure: the failed attempt here started on Org One and the push reports
  // personal.
  await push({ type: "profileData", data: profile(null, true) })
  assert.equal(alert(), null, "a push for another account must clear the failure")
  assert.equal(trigger().disabled, false, "the selector stays interactive after the clear")

  // Signing out ends any live attempt, so nothing returns after the next login.
  await open()
  await press(option("Org Two"))
  const abandoned = switchPost()
  assert.equal(trigger().disabled, true, "the attempt is pending before the session ends")
  await push({ type: "profileData", data: null })
  assert.equal(root.querySelector('[data-slot="select-select-trigger"]'), null, "signing out replaces the account card")

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
