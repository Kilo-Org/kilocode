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

const View = () => {
  const server = useServer()
  return (
    <ProfileView
      profileData={server.profileData()}
      profileStatus={server.profileStatus()}
      deviceAuth={{ status: "idle" }}
      onLogin={() => {}}
    />
  )
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

const push = async (message: ExtensionMessage) => {
  post(message, window)
  await settle()
}

const profile: ProfileData = {
  profile: { email: "user@example.test", name: "Test User" },
  balance: null,
  kiloPass: null,
  currentOrgId: null,
}

const text = () => root.textContent ?? ""
const button = (label: string) =>
  [...root.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === label)

try {
  // Nobody signed in: the plain signed-out copy with the login button.
  await push({ type: "profileData", data: null })
  assert.equal(text().includes("Not logged in"), true, "a missing profile reads as signed out")
  assert(button("Login with Kilo Code"), "signed out offers the login")

  // Kilo rejected the stored login: say so, and still offer the login.
  await push({ type: "profileStatus", status: "expired" })
  assert.equal(text().includes("Your Kilo login has expired or was revoked."), true, "a rejected login is explained")
  assert.equal(text().includes("Not logged in"), false, "a rejected login replaces the signed-out copy")
  assert(button("Login with Kilo Code"), "a rejected login offers the login")

  // A read that could not complete without a known account: offer a retry, not a login.
  await push({ type: "profileData", data: null })
  await push({ type: "profileStatus", status: "unavailable" })
  assert.equal(text().includes("Couldn't load your Kilo profile."), true, "an outage is not reported as signed out")
  assert.equal(button("Login with Kilo Code"), undefined, "an outage does not ask the user to sign in")
  const retry = button("Retry")
  assert(retry, "an outage offers a retry")
  retry.click()
  await settle()
  assert.equal(posted.at(-1)?.type, "refreshProfile", "Retry reads the profile again")

  // A known account survives a read that could not complete, with a notice.
  await push({ type: "profileData", data: profile })
  await push({ type: "profileStatus", status: "unavailable" })
  assert.equal(text().includes("Test User"), true, "an outage keeps the last known account")
  assert.equal(text().includes("Couldn't refresh your profile."), true, "an outage over a known account is noted")

  // The next successful read clears the notice.
  await push({ type: "profileData", data: profile })
  assert.equal(text().includes("Couldn't refresh your profile."), false, "a successful read clears the notice")
} finally {
  dispose()
  root.remove()
  await window.happyDOM.close()
}
