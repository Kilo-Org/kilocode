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
  HTMLButtonElement: window.HTMLButtonElement,
  SVGElement: window.SVGElement,
  MutationObserver: window.MutationObserver,
  ResizeObserver: window.ResizeObserver,
  IntersectionObserver: window.IntersectionObserver,
  Event: window.Event,
  MouseEvent: window.MouseEvent,
  MessageEvent: window.MessageEvent,
  customElements: window.customElements,
  getComputedStyle: window.getComputedStyle.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
})

const posted: unknown[] = []
Object.assign(globalThis, {
  acquireVsCodeApi: () => ({
    postMessage: (msg: unknown) => posted.push(msg),
    getState: () => undefined,
    setState: () => undefined,
  }),
})

const { createSignal } = await import("solid-js")
const { render } = await import("solid-js/web")
const { VSCodeProvider } = await import("../../webview-ui/src/context/vscode")
const { LanguageProvider } = await import("../../webview-ui/src/context/language")
const { DialogProvider } = await import("@kilocode/kilo-ui/context/dialog")
const { ErrorCard } = await import("../../webview-ui/src/v2/assistant")
const { ProfilePanel } = await import("../../webview-ui/src/v2/SettingsApp")
const { default: DeviceAuthCard } = await import("../../webview-ui/src/components/profile/DeviceAuthCard")
const { V2Scope } = await import("../../webview-ui/src/v2/client")
const { post } = await import("../../webview-ui/src/utils/webview-message")

const REJECTED_BODY = JSON.stringify({
  error: { code: "INVALID_TOKEN", message: "Your authentication token is invalid. Please sign in again." },
  error_type: "authentication_required",
})

// 1. ErrorCard: 401 INVALID_TOKEN shows auth-prompt with Sign in button posting openProfile { login: true }.
{
  posted.length = 0
  const root = document.createElement("div")
  document.body.append(root)
  const dispose = render(
    () => (
      <VSCodeProvider>
        <LanguageProvider>
          <ErrorCard
            error={{
              message: "You've been signed out of Kilo.",
              status: 401,
              response: { body: REJECTED_BODY },
            }}
          />
        </LanguageProvider>
      </VSCodeProvider>
    ),
    root,
  )

  const prompt = root.querySelector('[data-component="auth-prompt"]')
  assert.ok(prompt, "expected auth-prompt card for 401 INVALID_TOKEN")
  assert.equal(root.querySelector(".error-card"), null)
  assert.ok(prompt.textContent?.includes("Kilo Gateway signed you out"))
  assert.ok(prompt.textContent?.includes("Reconnect Kilo Gateway, then send your message again."))

  const signIn = [...prompt.querySelectorAll("button")].find((btn) => btn.textContent?.trim() === "Sign in")
  assert.ok(signIn, "expected Sign in button")
  posted.length = 0
  signIn.click()
  assert.deepEqual(posted, [{ type: "openProfile", login: true }])

  dispose()
  root.remove()
}

// 2. ErrorCard: non-401 INVALID_TOKEN and 401 PAID_MODEL_AUTH_REQUIRED render standard error-card.
{
  for (const error of [
    { message: "Bad request", status: 400, response: { body: REJECTED_BODY } },
    {
      message: "You need to sign in to use this model.",
      status: 401,
      response: { body: JSON.stringify({ error: { code: "PAID_MODEL_AUTH_REQUIRED" } }) },
    },
  ]) {
    const root = document.createElement("div")
    document.body.append(root)
    const dispose = render(
      () => (
        <VSCodeProvider>
          <LanguageProvider>
            <ErrorCard error={error} />
          </LanguageProvider>
        </VSCodeProvider>
      ),
      root,
    )
    assert.equal(root.querySelector('[data-component="auth-prompt"]'), null)
    assert.ok(root.querySelector(".error-card"))
    dispose()
    root.remove()
  }
}

// 3. DeviceAuthCard: default countdown fallback is 600s (10:00), not 900s (15:00).
{
  const root = document.createElement("div")
  document.body.append(root)
  const dispose = render(
    () => (
      <VSCodeProvider>
        <LanguageProvider>
          <DialogProvider>
            <V2Scope value={{ open: () => undefined } as never}>
              <DeviceAuthCard
                status="pending"
                code="ABCD-1234"
                verificationUrl="https://app.kilo.ai/device?code=ABCD-1234"
                onCancel={() => undefined}
              />
            </V2Scope>
          </DialogProvider>
        </LanguageProvider>
      </VSCodeProvider>
    ),
    root,
  )
  assert.ok(root.textContent?.includes("10:00"), `expected 10:00 countdown, got: ${root.textContent}`)
  assert.equal(root.textContent?.includes("15:00"), false)
  dispose()
  root.remove()
}

// 4. ProfilePanel: sends profileReady on mount and starts login (showing DeviceAuthCard even if stale profile data exists) when profileLogin arrives.
{
  posted.length = 0
  const [data, setData] = createSignal<unknown>({
    profile: { email: "stale@example.com", name: "Stale User", organizations: [], hasPersonalAccount: true, organizationID: null },
    balance: null,
    kiloPass: null,
  })
  const [auth, setAuth] = createSignal<{ status: "idle" | "initiating" | "pending" }>({ status: "idle" })
  let logins = 0
  const fakeProfile = {
    data,
    status: () => undefined,
    auth,
    refresh: () => undefined,
    usage: () => undefined,
    usageLoading: () => false,
    usageError: () => undefined,
    requestUsage: () => undefined,
    refreshUsage: () => undefined,
    login: () => {
      logins++
      setData(null)
      setAuth({ status: "initiating" })
    },
    cancel: () => undefined,
    logout: () => undefined,
    setOrganization: () => undefined,
  }

  const root = document.createElement("div")
  document.body.append(root)
  const dispose = render(
    () => (
      <VSCodeProvider>
        <LanguageProvider>
          <DialogProvider>
            <V2Scope value={{ open: () => undefined } as never}>
              <ProfilePanel profile={fakeProfile as never} />
            </V2Scope>
          </DialogProvider>
        </LanguageProvider>
      </VSCodeProvider>
    ),
    root,
  )

  assert.deepEqual(
    posted.filter((msg) => (msg as { type?: string }).type === "profileReady"),
    [{ type: "profileReady" }],
  )
  assert.equal(logins, 0)
  assert.ok(root.textContent?.includes("stale@example.com"))

  post({ type: "profileLogin" })
  await window.happyDOM.waitUntilComplete()

  assert.equal(logins, 1)
  assert.equal(auth().status, "initiating")
  assert.equal(root.textContent?.includes("stale@example.com"), false)

  dispose()
  root.remove()
}

await window.happyDOM.close()
