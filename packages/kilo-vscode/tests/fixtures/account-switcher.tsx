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
const { ServerProvider } = await import("../../webview-ui/src/context/server")
const { LanguageProvider } = await import("../../webview-ui/src/context/language")
const { AccountSwitcher } = await import("../../webview-ui/src/components/shared/AccountSwitcher")
const { post } = await import("../../webview-ui/src/utils/webview-message")

const root = document.createElement("div")
document.body.append(root)

const dispose = render(
  () => (
    <VSCodeProvider>
      <ServerProvider>
        <LanguageProvider>
          <AccountSwitcher />
        </LanguageProvider>
      </ServerProvider>
    </VSCodeProvider>
  ),
  root,
)

const settle = () => window.happyDOM.waitUntilComplete()

const profile = (currentOrgId: string | null, hasPersonalAccount: boolean): ProfileData => ({
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
  const node = root.querySelector<HTMLButtonElement>(".account-switcher-trigger")
  assert(node, "the trigger was not rendered")
  return node
}

const rows = () => [...root.querySelectorAll<HTMLButtonElement>('[role="option"]')]

const row = (name: string) => {
  const found = rows().find((node) => node.textContent?.includes(name))
  assert(
    found,
    `no row for ${name} in ${rows()
      .map((node) => node.textContent)
      .join(", ")}`,
  )
  return found
}

const open = async () => {
  trigger().click()
  await settle()
}

const close = async () => {
  if (trigger().getAttribute("aria-expanded") !== "true") return
  trigger().click()
  await settle()
}

const switchPosts = () => posted.filter((message) => message.type === "setOrganization")

interface SwitchRequest {
  type: "setOrganization"
  organizationId: string | null
  requestID: string
}

/** A posted switch request with its correlation id narrowed; a missing one is a test failure. */
function switchPost(index: number): SwitchRequest {
  const posts = switchPosts()
  const found = posts[index]
  assert(found, `expected a switch request at index ${index}, saw ${posts.length}`)
  assert.equal(typeof found.requestID, "string", "the switch must carry a correlation id")
  return { type: found.type, organizationId: found.organizationId ?? null, requestID: found.requestID }
}

const alert = () => root.querySelector('[role="alert"]')

const retryButton = () => {
  const node = root.querySelector<HTMLButtonElement>(".account-switcher-retry")
  assert(node, "the retry control was not rendered")
  return node
}

try {
  // 1. No personal account: nothing is active, and picking the only org posts it.
  await push({ type: "profileData", data: profile(null, false) })
  assert.equal(rows().length, 0, "the dropdown should be closed")
  assert.equal(trigger().getAttribute("aria-busy"), "false")
  assert.equal(trigger().textContent?.includes("Personal Account"), true)
  await open()
  assert.equal(row("Org One").getAttribute("aria-selected"), "false", "no row may claim the active account")
  assert.equal(row("Org Two").getAttribute("aria-selected"), "false")
  row("Org One").click()
  await settle()
  const first = switchPost(0)
  assert.equal(switchPosts().length, 1, "picking the org should post one switch")
  assert.deepEqual(
    { type: first.type, organizationId: first.organizationId },
    { type: "setOrganization", organizationId: "org-1" },
  )
  const firstID = first.requestID
  assert.equal(trigger().disabled, true, "the trigger must be disabled while the switch is pending")
  assert.equal(trigger().getAttribute("aria-busy"), "true")

  // A failed result re-enables the trigger, shows the message, and Retry re-posts.
  await push({
    type: "organizationSwitchResult",
    requestID: firstID,
    organizationId: "org-1",
    ok: false,
    data: null,
    error: "switch rejected",
  })
  assert.equal(trigger().disabled, false, "a failed switch must re-enable the trigger")
  assert.equal(trigger().getAttribute("aria-busy"), "false")
  assert.equal(alert()?.textContent?.includes("switch rejected"), true, "the failure message must be visible")
  assert.equal(trigger().getAttribute("title"), "switch rejected")
  await open()
  assert.equal(rows().length, 2, "the dropdown must stay usable after a failure so another account can be picked")
  await close()
  retryButton().click()
  await settle()
  const retried = switchPost(1)
  assert.equal(switchPosts().length, 2, "Retry must post again")
  assert.equal(retried.organizationId, "org-1", "Retry must target the same account")
  assert.notEqual(retried.requestID, first.requestID, "Retry must use a fresh request id")

  // A late reply for the abandoned attempt is ignored; the active one settles.
  await push({
    type: "organizationSwitchResult",
    requestID: firstID,
    organizationId: "org-1",
    ok: true,
    data: profile("org-1", false),
  })
  assert.equal(trigger().disabled, true, "a stale result must not settle the active attempt")
  // The host pushes the fresh profile before the result, so the label follows it.
  await push({ type: "profileData", data: profile("org-1", false) })
  assert.equal(trigger().disabled, true, "a profile push must not settle a pending attempt")
  await push({
    type: "organizationSwitchResult",
    requestID: retried.requestID ?? "",
    organizationId: "org-1",
    ok: true,
    data: profile("org-1", false),
  })
  assert.equal(trigger().disabled, false, "the matching result must settle the attempt")
  assert.equal(alert(), null, "a success must clear the failure note")
  assert.equal(trigger().textContent?.includes("Org One"), true)

  // 2. The active org is listed: its row is selected, and picking it posts nothing.
  await push({ type: "profileData", data: profile("org-1", true) })
  assert.equal(trigger().getAttribute("title"), "Org One – ADMIN")
  await open()
  assert.equal(row("Org One").getAttribute("aria-selected"), "true")
  const before = switchPosts().length
  row("Org One").click()
  await settle()
  assert.equal(switchPosts().length, before, "picking the active account must not post")
  assert.equal(trigger().getAttribute("aria-expanded"), "false", "picking must close the dropdown")

  // Picking personal posts a null organization.
  await open()
  assert.equal(row("Personal Account").getAttribute("aria-selected"), "false")
  row("Personal Account").click()
  await settle()
  const personal = switchPost(before)
  assert.equal(switchPosts().length, before + 1)
  assert.equal(personal.organizationId, null)
  await push({ type: "profileData", data: profile(null, true) })
  await push({
    type: "organizationSwitchResult",
    requestID: personal.requestID,
    organizationId: null,
    ok: true,
    data: profile(null, true),
  })
  assert.equal(trigger().disabled, false, "the personal switch must settle")

  // 3. An active org missing from the list renders one selected, disabled row.
  await push({ type: "profileData", data: profile("org-3", false) })
  assert.equal(trigger().textContent?.includes("Unavailable account"), true, "the trigger must not show personal")
  assert.equal(trigger().textContent?.includes("Personal Account"), false)
  await open()
  const unavailable = row("Unavailable account")
  assert.equal(unavailable.getAttribute("aria-selected"), "true")
  assert.equal(unavailable.disabled, true, "the unavailable row must not be pickable")
  assert.equal(
    rows().filter((node) => node.getAttribute("aria-selected") === "true").length,
    1,
    "exactly one row may be selected",
  )
  const beforeUnavailable = switchPosts().length
  row("Org Two").click()
  await settle()
  const orgTwo = switchPost(beforeUnavailable)
  assert.equal(switchPosts().length, beforeUnavailable + 1)
  assert.equal(orgTwo.organizationId, "org-2")
  await push({ type: "profileData", data: profile("org-2", false) })
  await push({
    type: "organizationSwitchResult",
    requestID: orgTwo.requestID,
    organizationId: "org-2",
    ok: true,
    data: profile("org-2", false),
  })
  assert.equal(trigger().disabled, false, "the org switch must settle")

  // Only the unavailable row: still visible, so the scoped account is never hidden.
  const scoped = profile("org-3", false)
  await push({
    type: "profileData",
    data: { ...scoped, profile: { ...scoped.profile, organizations: [] } },
  })
  assert(trigger(), "the switcher must stay visible with only an unavailable account")
  await open()
  assert.equal(rows().length, 1, "only the unavailable row should remain")
  assert.equal(rows()[0]?.disabled, true)
  await close()

  // 4. A profileData push never terminates a pending switch; the result owns it.
  await push({ type: "profileData", data: profile("org-1", true) })
  await open()
  row("Org Two").click()
  await settle()
  const pending = switchPost(switchPosts().length - 1)
  await push({ type: "profileData", data: profile("org-1", true) })
  assert.equal(trigger().disabled, true, "a profile push must not clear a pending switch")
  await push({
    type: "organizationSwitchResult",
    requestID: pending.requestID,
    organizationId: "org-2",
    ok: true,
    data: profile("org-2", true),
  })
  assert.equal(trigger().disabled, false)

  // 5. A failed confirmation leaves the last-known profile in place, so the
  // control keeps naming the active account and its failure stays retryable.
  await open()
  row("Org Two").click()
  await settle()
  const unread = switchPost(switchPosts().length - 1)
  await push({
    type: "organizationSwitchResult",
    requestID: unread.requestID,
    organizationId: "org-2",
    ok: false,
    data: null,
    error: "profile unavailable",
  })
  assert.equal(trigger().textContent?.includes("Org One"), true, "the trigger must keep the last-known account")
  assert.equal(
    trigger().textContent?.includes("Personal Account"),
    false,
    "a failed read must not relabel an organization as personal",
  )
  assert.equal(alert()?.textContent?.includes("profile unavailable"), true, "the failure must be visible")
  assert.equal(trigger().disabled, false, "the trigger must be enabled after the failure")
  await open()
  assert.equal(rows().length, 3, "the dropdown must stay usable after a failed read")
  await close()
  retryButton().click()
  await settle()
  const afterFailure = switchPost(switchPosts().length - 1)
  assert.equal(afterFailure.organizationId, "org-2", "Retry must re-post the same target")
  assert.notEqual(afterFailure.requestID, unread.requestID, "Retry must use a fresh request id")

  // 6. Signing out after a failed attempt must not leave the control mounted.
  await push({
    type: "organizationSwitchResult",
    requestID: afterFailure.requestID,
    organizationId: "org-2",
    ok: false,
    data: null,
    error: "switch rejected",
  })
  assert(root.querySelector(".account-switcher"), "a failure must keep the control mounted")

  // A later profile read that shows the attempted account applied ends the
  // failed attempt, so no stale alert and no Retry for an applied switch remain.
  await push({ type: "profileData", data: profile("org-2", true) })
  assert.equal(alert(), null, "a profile push that shows the target applied must clear the failure")
  assert.equal(trigger().disabled, false, "the trigger stays enabled after the clear")
  assert.equal(trigger().textContent?.includes("Org Two"), true, "the label follows the applied account")

  // A push that still reports another account keeps the failure.
  await open()
  row("Org One").click()
  await settle()
  const pendingElsewhere = switchPost(switchPosts().length - 1)
  await push({
    type: "organizationSwitchResult",
    requestID: pendingElsewhere.requestID,
    organizationId: "org-1",
    ok: false,
    data: null,
    error: "profile unavailable",
  })
  await push({ type: "profileData", data: profile("org-2", true) })
  assert(alert(), "a push for a different account must keep the failure")

  // A push that reports an account other than the one the attempt started from
  // was superseded by a switch made in the other surface, so it ends too: here
  // the failed attempt started on Org Two and a push now reports personal.
  await push({ type: "profileData", data: profile(null, true) })
  assert.equal(alert(), null, "a push for another account must clear the failure")
  assert.equal(trigger().disabled, false, "the trigger stays enabled after the clear")
  assert.equal(trigger().textContent?.includes("Personal Account"), true, "the label follows the applied account")

  // Signing out after a failed attempt must not leave the control mounted.
  await push({ type: "profileData", data: null })
  assert.equal(root.querySelector(".account-switcher"), null, "a signed-out session must not show the control")

  // 7. Signing out during a pending attempt ends that attempt, so the next
  // session starts interactive and a late answer changes nothing.
  await push({ type: "profileData", data: profile("org-1", true) })
  await open()
  row("Org Two").click()
  await settle()
  const abandoned = switchPost(switchPosts().length - 1)
  assert.equal(trigger().disabled, true, "the attempt is pending before the session ends")
  await push({ type: "profileData", data: null })
  await push({
    type: "organizationSwitchResult",
    requestID: abandoned.requestID,
    organizationId: "org-2",
    ok: false,
    data: null,
    error: "late",
  })
  await push({ type: "profileData", data: profile("org-1", true) })
  assert.equal(trigger().disabled, false, "the next session starts interactive")
  assert.equal(alert(), null, "the next session must not carry the abandoned attempt")
  assert.equal(trigger().textContent?.includes("Org One"), true, "the next session shows its own account")
} finally {
  dispose()
  root.remove()
  await window.happyDOM.close()
}
