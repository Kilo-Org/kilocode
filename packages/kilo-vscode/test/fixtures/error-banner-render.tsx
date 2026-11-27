import assert from "node:assert/strict"
import { Window } from "happy-dom"

const window = new Window({ url: "http://localhost" })
Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  HTMLButtonElement: window.HTMLButtonElement,
  SVGElement: window.SVGElement,
  MutationObserver: window.MutationObserver,
  ResizeObserver: window.ResizeObserver,
  IntersectionObserver: window.IntersectionObserver,
  Event: window.Event,
  MouseEvent: window.MouseEvent,
  getComputedStyle: window.getComputedStyle.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
})

const { createRoot, createSignal } = await import("solid-js")
const { render } = await import("solid-js/web")
const { LanguageContext } = await import("../../webview-ui/src/context/language")
const { resolveTemplate } = await import("../../webview-ui/src/context/language-utils")
const { dict } = await import("../../webview-ui/src/i18n/en")
const { createBannerState, ErrorBanner } = await import("../../webview-ui/src/v2/error-banner")

const language = {
  locale: () => "en" as const,
  setLocale: () => undefined,
  userOverride: () => "" as const,
  t: (key: string, params?: Record<string, string | number | boolean | undefined>) =>
    resolveTemplate((dict as Record<string, string>)[key] ?? key, params),
}

const host = document.createElement("div")
document.body.append(host)

let dismissed = 0
const failure = {
  key: "error.failure.timeout",
  message: "The Kilo server took too long to respond. Try again.",
  details: "ClientError: UnexpectedStatus: 408\n    at stream",
}

const dispose = render(
  () => (
    <LanguageContext.Provider value={language}>
      <ErrorBanner failure={failure} onDismiss={() => dismissed++} />
    </LanguageContext.Provider>
  ),
  host,
)

const banner = () => host.querySelector<HTMLElement>(".startup-error-banner")!
const toggle = () => host.querySelector<HTMLButtonElement>(".startup-error-toggle")!
const details = () => host.querySelector<HTMLElement>(".startup-error-details")

assert.ok(banner())
assert.equal(banner().getAttribute("role"), "alert")
assert.equal(host.querySelector(".startup-error-message")?.textContent, failure.message)

// The technical text stays behind the disclosure until the user asks for it.
assert.equal(details(), null)
assert.equal(toggle().getAttribute("aria-expanded"), "false")
toggle().click()
assert.equal(toggle().getAttribute("aria-expanded"), "true")
assert.equal(details()?.textContent, failure.details)
toggle().click()
assert.equal(details(), null)

host.querySelector<HTMLButtonElement>(".startup-error-dismiss")!.click()
assert.equal(dismissed, 1)

dispose()
host.remove()

// A failure without details is a plain sentence: no chevron, no dead disclosure, no dismiss
// unless the surface passes one.
const quiet = document.createElement("div")
document.body.append(quiet)
const disposeQuiet = render(
  () => (
    <LanguageContext.Provider value={language}>
      <ErrorBanner failure={{ key: "error.failure.notKilo", message: "Not a Kilo v2 server." }} />
    </LanguageContext.Provider>
  ),
  quiet,
)

assert.equal(quiet.querySelector(".startup-error-message")?.textContent, "Not a Kilo v2 server.")
assert.equal(quiet.querySelector(".startup-error-toggle"), null)
assert.equal(quiet.querySelector(".startup-error-chevron"), null)
assert.equal(quiet.querySelector(".startup-error-action"), null)
assert.equal(quiet.querySelector(".startup-error-dismiss"), null)
disposeQuiet()

// An optional recovery action (e.g. Sign in) renders alongside Dismiss and fires when clicked.
const actionable = document.createElement("div")
document.body.append(actionable)
let signedIn = 0
let authDismissed = 0
const disposeActionable = render(
  () => (
    <LanguageContext.Provider value={language}>
      <ErrorBanner
        failure={{
          key: "provider.failure.unauthorized",
          message: "Credentials rejected (HTTP 401). Sign in again.",
          params: { status: 401 },
          auth: true,
        }}
        action={{ label: language.t("common.signIn"), onClick: () => signedIn++ }}
        onDismiss={() => authDismissed++}
      />
    </LanguageContext.Provider>
  ),
  actionable,
)
const actionButton = actionable.querySelector<HTMLButtonElement>(".startup-error-action")
assert.ok(actionButton)
assert.equal(actionButton.textContent, "Sign in")
actionButton.click()
assert.equal(signedIn, 1)
actionable.querySelector<HTMLButtonElement>(".startup-error-dismiss")!.click()
assert.equal(authDismissed, 1)
disposeActionable()
actionable.remove()

// createBannerState prioritizes handshake > failure > inbox > catalog auth failure, attaches Sign in when auth is
// needed, and clears catalog dismissal once the catalog recovers.
createRoot((dispose) => {
  const [handshake, setHandshake] = createSignal<{ key: string; message: string } | undefined>(undefined)
  const [scopeFailure, setScopeFailure] = createSignal<{ key: string; message: string; auth?: boolean } | undefined>(
    undefined,
  )
  const [inboxFailure, setInboxFailure] = createSignal<{ key: string; message: string; auth?: boolean } | undefined>(
    undefined,
  )
  const [kiloFailure, setKiloFailure] = createSignal<
    { kind: "unauthorized" | "unauthenticated" | "network"; status?: number } | undefined
  >(undefined)
  let loginClicks = 0
  const state = createBannerState({
    handshake,
    failure: scopeFailure,
    clearError: () => setScopeFailure(undefined),
    inbox: inboxFailure,
    dismissInbox: () => setInboxFailure(undefined),
    kiloFailure,
    signInLabel: () => "Sign in",
    onSignIn: () => loginClicks++,
  })

  assert.equal(state(), undefined)

  // Non-auth catalog failure (network) does not trigger the auth banner.
  setKiloFailure({ kind: "network" })
  assert.equal(state(), undefined)

  // Auth catalog failure surfaces a Sign in action and can be dismissed until recovery.
  setKiloFailure({ kind: "unauthorized", status: 401 })
  assert.equal(state()?.failure.key, "provider.failure.unauthorized")
  assert.equal(state()?.action?.label, "Sign in")
  state()?.action?.onClick()
  assert.equal(loginClicks, 1)
  state()?.onDismiss?.()
  assert.equal(state(), undefined)

  // Re-emitting an identical failure keeps it dismissed; recovering and failing again shows it fresh.
  setKiloFailure({ kind: "unauthorized", status: 401 })
  assert.equal(state(), undefined)
  setKiloFailure(undefined)
  setKiloFailure({ kind: "unauthenticated" })
  assert.equal(state()?.failure.key, "provider.failure.unauthenticated")
  assert.equal(state()?.action?.label, "Sign in")

  // A directory failure with auth=true attaches Sign in; a non-auth failure without catalog auth failure does not.
  setKiloFailure(undefined)
  setScopeFailure({ key: "error.failure.timeout", message: "Timed out" })
  assert.equal(state()?.action, undefined)
  setScopeFailure({ key: "error.failure.status", message: "401", auth: true })
  assert.equal(state()?.action?.label, "Sign in")

  // Handshake error takes precedence with no Sign in action and no dismiss.
  setHandshake({ key: "error.failure.notKilo", message: "Not a Kilo v2 server." })
  assert.equal(state()?.failure.key, "error.failure.notKilo")
  assert.equal(state()?.action, undefined)
  assert.equal(state()?.onDismiss, undefined)
  dispose()
})
