import { describe, expect, it } from "bun:test"
import { createKiloClient } from "@kilocode/sdk/v2/client"
import { handleSetOrganization, type AuthContext } from "../../src/kilo-provider/handlers/auth"
import type { ProfileData } from "../../webview-ui/src/types/messages/profile"

const profile: ProfileData = {
  profile: { email: "user@example.test", organizations: [{ id: "org-1", name: "Org One", role: "admin" }] },
  balance: null,
  kiloPass: null,
  currentOrgId: "org-1",
}

type Reply = { status: number; body: unknown }

/**
 * A real client over a stubbed transport, so the handler exercises the same
 * request pipeline the extension uses without a running backend.
 */
function ctx(opts: { set: Reply; profile: Reply }) {
  const messages: unknown[] = []
  const requests: string[] = []
  const fetch = async (request: Request) => {
    const url = new URL(request.url)
    requests.push(`${request.method} ${url.pathname}`)
    const reply = url.pathname === "/kilo/organization" ? opts.set : opts.profile
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "content-type": "application/json" },
    })
  }
  const fake: AuthContext = {
    client: createKiloClient({ baseUrl: "http://127.0.0.1:4096", fetch }),
    postMessage: (msg) => messages.push(msg),
    getWorkspaceDirectory: () => "/workspace",
    disposeGlobal: async () => {},
    invalidateProviderUsage: () => {},
    invalidateProviders: () => {},
    fetchAndSendProviders: async () => {},
    fetchAndSendAgents: async () => {},
    fetchAndSendSpeechToTextModels: async () => {},
  }
  return { fake, messages, requests }
}

interface SwitchResult {
  type: "organizationSwitchResult"
  requestID: string
  ok: boolean
  data: unknown
  error?: string
}

function isSwitchResult(message: unknown): message is SwitchResult {
  return (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === "organizationSwitchResult" &&
    "requestID" in message
  )
}

const results = (messages: unknown[]) => messages.filter(isSwitchResult)

/** Assert exactly one outcome was posted and return it for field assertions. */
function only(messages: unknown[]): SwitchResult {
  const posted = results(messages)
  expect(posted).toHaveLength(1)
  const [result] = posted
  return result
}

describe("handleSetOrganization", () => {
  it("reports success with the profile read after the switch", async () => {
    const { fake, messages, requests } = ctx({
      set: { status: 200, body: {} },
      profile: { status: 200, body: profile },
    })
    await handleSetOrganization(fake, "org-1", "request-1")

    expect(requests).toEqual(["POST /kilo/organization", "GET /kilo/profile"])
    const result = only(messages)
    expect(result).toMatchObject({ requestID: "request-1", ok: true })
    expect("error" in result).toBe(false)
    expect(result.data).toMatchObject({ currentOrgId: "org-1" })
  })

  it("reports failure when the switch applies but the profile read fails", async () => {
    const { fake, messages } = ctx({
      set: { status: 200, body: {} },
      profile: { status: 500, body: { message: "profile unavailable" } },
    })
    await handleSetOrganization(fake, "org-1", "request-2")

    const result = only(messages)
    expect(result).toMatchObject({ requestID: "request-2", ok: false, data: null })
    expect(result.error).toBeTruthy()
  })

  it("reports the switch error alongside the profile it read afterwards", async () => {
    const { fake, messages } = ctx({
      set: { status: 500, body: { message: "switch rejected" } },
      profile: { status: 200, body: profile },
    })
    await handleSetOrganization(fake, "org-1", "request-3")

    const result = only(messages)
    expect(result).toMatchObject({ requestID: "request-3", ok: false })
    expect(result.error).toBeTruthy()
    expect(result.data).toMatchObject({ currentOrgId: "org-1" })
  })

  it("reports one failure when both the switch and the profile read fail", async () => {
    const { fake, messages } = ctx({
      set: { status: 500, body: { message: "switch rejected" } },
      profile: { status: 500, body: { message: "profile unavailable" } },
    })
    await handleSetOrganization(fake, null, "request-4")

    const result = only(messages)
    expect(result).toMatchObject({ requestID: "request-4", ok: false, data: null })
    expect(result.error).toBeTruthy()
  })

  it("reports one failure without a client", async () => {
    const messages: unknown[] = []
    const fake: AuthContext = {
      client: null,
      postMessage: (msg) => messages.push(msg),
      getWorkspaceDirectory: () => "/workspace",
      disposeGlobal: async () => {},
      invalidateProviderUsage: () => {},
      invalidateProviders: () => {},
      fetchAndSendProviders: async () => {},
      fetchAndSendAgents: async () => {},
      fetchAndSendSpeechToTextModels: async () => {},
    }
    await handleSetOrganization(fake, "org-1", "request-5")

    const result = only(messages)
    expect(result).toMatchObject({ requestID: "request-5", ok: false, data: null })
    expect(result.error).toBeTruthy()
  })
})
