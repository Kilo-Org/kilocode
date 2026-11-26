import assert from "node:assert/strict"
import { Window } from "happy-dom"
import type { AssistantMessage } from "@kilocode/sdk/v2"
import type { ExtensionMessage, ProfileData, WebviewMessage } from "../../webview-ui/src/types/messages"

const window = new Window({ url: "https://kilo.test" })
Object.defineProperty(window, "origin", { value: window.location.origin })
const posted: WebviewMessage[] = []
const messages: unknown[] = []

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
  acquireVsCodeApi: () => ({
    postMessage: (message: WebviewMessage) => posted.push(message),
    getState: () => undefined,
    setState: () => {},
  }),
})

const originalPostMessage = window.postMessage.bind(window)
window.postMessage = ((message: unknown, targetOrigin?: string) => {
  messages.push({ message, targetOrigin })
  return originalPostMessage(message, targetOrigin)
}) as typeof window.postMessage

const { createSignal } = await import("solid-js")
const { render } = await import("solid-js/web")
const { DialogProvider } = await import("@kilocode/kilo-ui/context/dialog")
const { VSCodeProvider } = await import("../../webview-ui/src/context/vscode")
const { interceptLogin, ServerProvider, useServer } = await import("../../webview-ui/src/context/server")
const { ProviderProvider } = await import("../../webview-ui/src/context/provider")
const { LanguageProvider } = await import("../../webview-ui/src/context/language")
const { ErrorDisplay } = await import("../../webview-ui/src/components/chat/ErrorDisplay")
const { default: ProfileView } = await import("../../webview-ui/src/components/profile/ProfileView")
const { post } = await import("../../webview-ui/src/utils/webview-message")

const settle = async () => {
  await Promise.resolve()
  await window.happyDOM.waitUntilComplete()
}

const push = async (message: ExtensionMessage) => {
  post(message, window)
  await settle()
}

const paid: NonNullable<AssistantMessage["error"]> = {
  name: "APIError",
  data: {
    statusCode: 401,
    message: "Unauthorized",
    isRetryable: false,
    responseBody: JSON.stringify({ error: { code: "PAID_MODEL_AUTH_REQUIRED" } }),
  },
}

const promo: NonNullable<AssistantMessage["error"]> = {
  name: "APIError",
  data: {
    statusCode: 401,
    message: "Limit reached",
    isRetryable: false,
    responseBody: JSON.stringify({ code: "PROMOTION_MODEL_LIMIT_REACHED" }),
  },
}

const staleProfile: ProfileData = {
  profile: {
    name: "Stale User",
    email: "stale@example.test",
    hasPersonalAccount: true,
    organizations: [],
  },
  balance: null,
  kiloPass: null,
  currentOrgId: null,
}

const [err, setErr] = createSignal<NonNullable<AssistantMessage["error"]>>(paid)
let ctx: ReturnType<typeof useServer> | undefined

const Harness = () => {
  const server = useServer()
  ctx = server
  return (
    <div>
      <section data-testid="error">
        <ErrorDisplay error={err()} onLogin={server.goToLogin} />
      </section>
      <section data-testid="profile">
        <ProfileView
          profileData={server.profileData()}
          profileStatus={server.profileStatus()}
          deviceAuth={server.deviceAuth()}
          onLogin={server.startLogin}
        />
      </section>
    </div>
  )
}

const root = document.createElement("div")
document.body.append(root)

const dispose = render(
  () => (
    <DialogProvider>
      <VSCodeProvider>
        <ServerProvider>
          <LanguageProvider>
            <ProviderProvider>
              <Harness />
            </ProviderProvider>
          </LanguageProvider>
        </ServerProvider>
      </VSCodeProvider>
    </DialogProvider>
  ),
  root,
)

const signInButton = () => {
  const button = root.querySelector<HTMLButtonElement>('[data-testid="error"] [data-component="auth-prompt"] button')
  assert(button, "ErrorDisplay sign-in button must render")
  return button
}

try {
  await settle()
  assert(ctx, "ServerProvider context must be initialized")

  // 1. Agent Manager mode: interceptLogin routes ErrorDisplay clicks to openProfilePanel
  // without starting a headless login or latching deviceAuth.
  const release = interceptLogin(() => posted.push({ type: "openProfilePanel", login: true }))
  posted.length = 0
  messages.length = 0

  signInButton().click()
  await settle()

  assert.deepEqual(
    posted.filter((msg) => msg.type === "openProfilePanel"),
    [{ type: "openProfilePanel", login: true }],
    "Agent Manager Sign in click must request opening Profile panel with login",
  )
  assert.equal(
    posted.some((msg) => msg.type === "login"),
    false,
    "Agent Manager must not post login to its own KiloProvider",
  )
  assert.equal(
    messages.some((entry) => (entry as { message?: { type?: string } }).message?.type === "navigate"),
    false,
    "Agent Manager must not dispatch inline navigate:profile",
  )
  assert.equal(ctx.deviceAuth().status, "idle", "Agent Manager deviceAuth must stay idle")

  // Repeated clicks (including promotion limit errors) keep routing instead of latching.
  setErr(promo)
  await settle()
  signInButton().click()
  await settle()

  assert.equal(
    posted.filter((msg) => msg.type === "openProfilePanel" && msg.login === true).length,
    2,
    "Subsequent Sign in clicks in Agent Manager must continue routing to Profile panel",
  )
  assert.equal(ctx.deviceAuth().status, "idle")

  // 2. Sidebar / Settings / Open-in-Tab mode (no interceptor): inline navigate + startLogin preserved.
  release()
  posted.length = 0
  messages.length = 0
  setErr(paid)
  await settle()

  // Seed a stale cached profile (key-rotation scenario) before starting login.
  await push({ type: "profileData", data: staleProfile })
  assert.equal(
    root.querySelector('[data-testid="profile"]')?.textContent?.includes("Stale User"),
    true,
    "Stale profile renders while deviceAuth is idle",
  )

  signInButton().click()
  await settle()

  assert.equal(
    posted.some((msg) => msg.type === "openProfilePanel"),
    false,
    "Inline webviews must not post openProfilePanel on goToLogin",
  )
  assert.equal(
    posted.some((msg) => msg.type === "login"),
    true,
    "Inline webviews must still post login on goToLogin",
  )
  assert.equal(
    messages.some((entry) => {
      const m = (entry as { message?: { type?: string; view?: string }; targetOrigin?: string }).message
      return m?.type === "navigate" && m.view === "profile"
    }),
    true,
    "Inline webviews must still dispatch navigate:profile on goToLogin",
  )
  assert.equal(ctx.deviceAuth().status, "initiating")

  // 3. ProfileView shows DeviceAuthCard even if stale profileData is still cached.
  await push({
    type: "deviceAuthStarted",
    code: "ABCD-1234",
    verificationUrl: "https://app.kilo.ai/device",
    expiresIn: 900,
  })
  const profileText = root.querySelector('[data-testid="profile"]')?.textContent ?? ""
  assert.equal(profileText.includes("ABCD-1234"), true, "ProfileView must show DeviceAuthCard with code during login")
  assert.equal(profileText.includes("Stale User"), false, "Stale profile must not hide DeviceAuthCard")

  // Cancelling login returns to idle and reflects the expired profile state from refreshProfile.
  await push({ type: "deviceAuthCancelled" })
  await push({ type: "profileData", data: null })
  await push({ type: "profileStatus", status: "expired" })
  assert.equal(ctx.deviceAuth().status, "idle")
  const afterCancel = root.querySelector('[data-testid="profile"]')?.textContent ?? ""
  assert.equal(afterCancel.includes("ABCD-1234"), false)
  assert.equal(afterCancel.includes("expired or was revoked"), true)
} finally {
  dispose()
  root.remove()
  await window.happyDOM.close()
}
