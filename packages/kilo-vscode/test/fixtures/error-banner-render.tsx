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

const { render } = await import("solid-js/web")
const { LanguageContext } = await import("../../webview-ui/src/context/language")
const { resolveTemplate } = await import("../../webview-ui/src/context/language-utils")
const { dict } = await import("../../webview-ui/src/i18n/en")
const { ErrorBanner } = await import("../../webview-ui/src/v2/error-banner")

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
      <ErrorBanner failure={{ message: "Not a Kilo v2 server." }} />
    </LanguageContext.Provider>
  ),
  quiet,
)

assert.equal(quiet.querySelector(".startup-error-message")?.textContent, "Not a Kilo v2 server.")
assert.equal(quiet.querySelector(".startup-error-toggle"), null)
assert.equal(quiet.querySelector(".startup-error-chevron"), null)
assert.equal(quiet.querySelector(".startup-error-dismiss"), null)
disposeQuiet()
