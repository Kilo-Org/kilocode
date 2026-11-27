import assert from "node:assert/strict"
import { Window } from "happy-dom"
import type { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"

const window = new Window({ url: "http://localhost" })
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

const { render } = await import("solid-js/web")
const { LanguageContext } = await import("../../webview-ui/src/context/language")
const { resolveTemplate } = await import("../../webview-ui/src/context/language-utils")
const { dict } = await import("../../webview-ui/src/i18n/en")
const { V2Scope } = await import("../../webview-ui/src/v2/client")
const { createProfile } = await import("../../webview-ui/src/v2/profile")
const { default: ProfileView } = await import("../../webview-ui/src/components/profile/ProfileView")

const language = {
  locale: () => "en" as const,
  setLocale: () => undefined,
  userOverride: () => "" as const,
  t: (key: string, params?: Record<string, string | number | boolean | undefined>) =>
    resolveTemplate((dict as Record<string, string>)[key] ?? key, params),
}

const sampleProfile: KiloGatewayRpc.Profile = {
  email: "user@example.test",
  name: "Test User",
  organizations: [],
  hasPersonalAccount: true,
  organizationID: null,
}

type Scenario = {
  authStatus: () => Promise<KiloGatewayRpc.AuthStatus>
  profile: () => Promise<KiloGatewayRpc.Profile>
}

let scenario: Scenario = {
  authStatus: async () => ({ authenticated: false, organizationID: null, server: "https://api.kilo.ai" }),
  profile: async () => sampleProfile,
}

let profileCalls = 0
const listeners = new Set<(event: { location?: { directory?: string } }) => void>()

const gatewayRpc = {
  authStatus: () => scenario.authStatus(),
  profile: () => {
    profileCalls++
    return scenario.profile()
  },
  balance: async () => ({ balance: 4.25 }),
  kiloPass: async () => null,
}

const usageRpc = {
  get: async () => ({ items: [], fetchedAt: 0 }),
  refresh: async () => ({ items: [], fetchedAt: 0 }),
}

const scope = {
  directory: "/repo",
  api: {
    rpc: (def: { id: string }) => (def.id === "kilocode.gateway" ? gatewayRpc : usageRpc),
  },
  data: {
    on: (type: string, handler: (event: { location?: { directory?: string } }) => void) => {
      if (type === "provider.updated") listeners.add(handler)
      return () => listeners.delete(handler)
    },
  },
  report: (error: unknown) => {
    throw error
  },
  open: () => undefined,
}

let control: ReturnType<typeof createProfile> | undefined

const View = () => {
  const profile = createProfile()
  control = profile
  return <ProfileView profile={profile} />
}

const root = document.createElement("div")
document.body.append(root)

const settle = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve()
  await window.happyDOM.waitUntilComplete()
}

const dispose = render(
  () => (
    <LanguageContext.Provider value={language}>
      <V2Scope value={scope as never}>
        <View />
      </V2Scope>
    </LanguageContext.Provider>
  ),
  root,
)

const text = () => root.textContent ?? ""
const button = (label: string) =>
  [...root.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === label)

try {
  // 1. Nobody signed in: plain signed-out copy with the login button.
  await settle()
  assert.equal(text().includes("Not logged in"), true, "signed out shows Not logged in")
  assert.ok(button("Login with Kilo Code"), "signed out offers the login button")

  // 2. Rejected OAuth login: explained as expired, with the login button.
  scenario = {
    authStatus: async () => ({
      authenticated: true,
      organizationID: null,
      server: "https://api.kilo.ai",
      method: "oauth",
    }),
    profile: async () => {
      throw { type: "unauthorized", message: "Invalid token" }
    },
  }
  control!.refresh()
  await settle()
  assert.equal(
    text().includes("Your Kilo login has expired or was revoked."),
    true,
    "rejected OAuth login is explained",
  )
  assert.equal(text().includes("Not logged in"), false, "rejected OAuth login replaces Not logged in")
  assert.ok(button("Login with Kilo Code"), "rejected OAuth login offers the login button")

  // 3. Rejected API key login: plain signed-out copy, NOT expired.
  scenario = {
    authStatus: async () => ({
      authenticated: true,
      organizationID: null,
      server: "https://api.kilo.ai",
      method: "key",
    }),
    profile: async () => {
      throw { type: "unauthorized", message: "Invalid token" }
    },
  }
  control!.refresh()
  await settle()
  assert.equal(text().includes("Not logged in"), true, "rejected API key shows Not logged in")
  assert.equal(text().includes("Your Kilo login has expired or was revoked."), false, "API key is not called expired")

  // 4. Outage without a loaded account: shows unavailable + Retry, not Login.
  scenario = {
    authStatus: async () => ({
      authenticated: true,
      organizationID: null,
      server: "https://api.kilo.ai",
      method: "oauth",
    }),
    profile: async () => {
      throw { type: "failed", message: "Profile fetch failed with status 500" }
    },
  }
  control!.refresh()
  await settle()
  assert.equal(text().includes("Couldn't load your Kilo profile."), true, "outage is not reported as signed out")
  assert.equal(button("Login with Kilo Code"), undefined, "outage does not show Login button")
  const retry = button("Retry")
  assert.ok(retry, "outage offers Retry")
  const callsBeforeRetry = profileCalls
  retry.click()
  await settle()
  assert.equal(profileCalls, callsBeforeRetry + 1, "Retry calls rpc.profile again")

  // 5. Successful read loads the account and clears status.
  scenario = {
    authStatus: async () => ({
      authenticated: true,
      organizationID: null,
      server: "https://api.kilo.ai",
      method: "oauth",
    }),
    profile: async () => sampleProfile,
  }
  control!.refresh()
  await settle()
  assert.equal(text().includes("Test User"), true, "loaded account shows user name")
  assert.equal(text().includes("Couldn't refresh your profile."), false, "no stale notice on healthy read")

  // 6. Outage over a known account keeps the account visible and shows the stale notice.
  scenario = {
    authStatus: async () => ({
      authenticated: true,
      organizationID: null,
      server: "https://api.kilo.ai",
      method: "oauth",
    }),
    profile: async () => {
      throw { type: "failed", message: "Profile fetch failed with status 500" }
    },
  }
  control!.refresh()
  await settle()
  assert.equal(text().includes("Test User"), true, "outage keeps the last known account")
  assert.equal(text().includes("Couldn't refresh your profile."), true, "outage over a known account shows stale notice")

  // 7. Next successful read clears the stale notice.
  scenario = {
    authStatus: async () => ({
      authenticated: true,
      organizationID: null,
      server: "https://api.kilo.ai",
      method: "oauth",
    }),
    profile: async () => sampleProfile,
  }
  control!.refresh()
  await settle()
  assert.equal(text().includes("Test User"), true, "recovered read keeps account visible")
  assert.equal(text().includes("Couldn't refresh your profile."), false, "recovered read clears stale notice")
} finally {
  dispose()
  root.remove()
  await window.happyDOM.close()
}
