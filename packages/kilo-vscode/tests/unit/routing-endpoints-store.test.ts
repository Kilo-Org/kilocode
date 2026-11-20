import { afterEach, describe, expect, it } from "bun:test"
import {
  endpointsEntry,
  handleEndpointsMessage,
  requestEndpoints,
  resetEndpointsStore,
} from "../../webview-ui/src/context/routing-endpoints"
import type { WebviewMessage } from "../../webview-ui/src/types/messages"

const endpoint = { provider: "gmicloud/fp8", name: "GMICloud" }
const scope = (providerID: string, modelID: string, directory = "/root") => ({ directory, providerID, modelID })

function collect() {
  const sent: WebviewMessage[] = []
  return { sent, post: (message: WebviewMessage) => sent.push(message) }
}

function id(sent: WebviewMessage[], index: number): number {
  const message = sent[index]
  if (message?.type !== "requestModelEndpoints") throw new Error("Expected a model endpoint request")
  return message.requestID
}

afterEach(() => {
  resetEndpointsStore()
})

describe("routing endpoints store", () => {
  it("requests once while in flight and caches successful results", () => {
    const { sent, post } = collect()

    requestEndpoints(scope("kilo", "z-ai/glm-4.6"), post)
    requestEndpoints(scope("kilo", "z-ai/glm-4.6"), post)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toEqual({
      type: "requestModelEndpoints",
      providerID: "kilo",
      modelID: "z-ai/glm-4.6",
      requestID: id(sent, 0),
      directory: "/root",
    })

    handleEndpointsMessage({
      type: "modelEndpointsLoaded",
      providerID: "kilo",
      modelID: "z-ai/glm-4.6",
      requestID: id(sent, 0),
      endpoints: [endpoint],
    })
    expect(endpointsEntry(scope("kilo", "z-ai/glm-4.6"))).toEqual({
      status: "ok",
      endpoints: [endpoint],
      at: expect.any(Number),
    })

    requestEndpoints(scope("kilo", "z-ai/glm-4.6"), post)
    expect(sent).toHaveLength(1)
  })

  it("does not cache failures: a failed request is retried and can succeed", () => {
    const { sent, post } = collect()

    requestEndpoints(scope("kilo", "z-ai/glm-4.6"), post)
    handleEndpointsMessage({
      type: "modelEndpointsLoaded",
      providerID: "kilo",
      modelID: "z-ai/glm-4.6",
      requestID: id(sent, 0),
      endpoints: [],
      error: true,
    })
    expect(endpointsEntry(scope("kilo", "z-ai/glm-4.6"))).toEqual({ status: "error" })

    requestEndpoints(scope("kilo", "z-ai/glm-4.6"), post)
    expect(sent).toHaveLength(2)

    handleEndpointsMessage({
      type: "modelEndpointsLoaded",
      providerID: "kilo",
      modelID: "z-ai/glm-4.6",
      requestID: id(sent, 1),
      endpoints: [endpoint],
    })
    expect(endpointsEntry(scope("kilo", "z-ai/glm-4.6"))).toEqual({
      status: "ok",
      endpoints: [endpoint],
      at: expect.any(Number),
    })
  })

  it("keys results by provider and model so identical model IDs do not share lists", () => {
    const { sent, post } = collect()

    requestEndpoints(scope("kilo", "z-ai/glm-4.6"), post)
    requestEndpoints(scope("openrouter", "z-ai/glm-4.6"), post)

    handleEndpointsMessage({
      type: "modelEndpointsLoaded",
      providerID: "kilo",
      modelID: "z-ai/glm-4.6",
      requestID: id(sent, 0),
      endpoints: [endpoint],
    })
    handleEndpointsMessage({
      type: "modelEndpointsLoaded",
      providerID: "openrouter",
      modelID: "z-ai/glm-4.6",
      requestID: id(sent, 1),
      endpoints: [],
    })

    expect(endpointsEntry(scope("kilo", "z-ai/glm-4.6"))).toEqual({
      status: "ok",
      endpoints: [endpoint],
      at: expect.any(Number),
    })
    expect(endpointsEntry(scope("openrouter", "z-ai/glm-4.6"))).toEqual({
      status: "ok",
      endpoints: [],
      at: expect.any(Number),
    })
  })

  it("keys results by workspace directory and names it on the request", () => {
    const { sent, post } = collect()

    requestEndpoints(scope("kilo", "z-ai/glm-4.6", "/root"), post)
    requestEndpoints(scope("kilo", "z-ai/glm-4.6", "/worktree"), post)
    requestEndpoints(scope("kilo", "z-ai/glm-4.6", ""), post)
    expect(sent).toEqual([
      { type: "requestModelEndpoints", providerID: "kilo", modelID: "z-ai/glm-4.6", requestID: 1, directory: "/root" },
      {
        type: "requestModelEndpoints",
        providerID: "kilo",
        modelID: "z-ai/glm-4.6",
        requestID: 2,
        directory: "/worktree",
      },
      { type: "requestModelEndpoints", providerID: "kilo", modelID: "z-ai/glm-4.6", requestID: 3 },
    ])

    const tree = { provider: "baseten/fp8", name: "Worktree organization" }
    handleEndpointsMessage({
      type: "modelEndpointsLoaded",
      providerID: "kilo",
      modelID: "z-ai/glm-4.6",
      requestID: id(sent, 1),
      directory: "/worktree",
      endpoints: [tree],
    })
    expect(endpointsEntry(scope("kilo", "z-ai/glm-4.6", "/worktree"))).toMatchObject({
      status: "ok",
      endpoints: [tree],
    })
    expect(endpointsEntry(scope("kilo", "z-ai/glm-4.6", "/root"))).toBeUndefined()

    handleEndpointsMessage({
      type: "modelEndpointsLoaded",
      providerID: "kilo",
      modelID: "z-ai/glm-4.6",
      requestID: id(sent, 0),
      directory: "/root",
      endpoints: [endpoint],
    })
    expect(endpointsEntry(scope("kilo", "z-ai/glm-4.6", "/root"))).toMatchObject({
      status: "ok",
      endpoints: [endpoint],
    })
    expect(endpointsEntry(scope("kilo", "z-ai/glm-4.6", "/worktree"))).toMatchObject({
      status: "ok",
      endpoints: [tree],
    })
  })

  it("ignores unrelated messages", () => {
    expect(handleEndpointsMessage({ type: "variantsLoaded", variants: {} })).toBe(false)
    expect(endpointsEntry(scope("kilo", "z-ai/glm-4.6"))).toBeUndefined()
  })

  it("ignores responses that were not requested", () => {
    handleEndpointsMessage({
      type: "modelEndpointsLoaded",
      providerID: "kilo",
      modelID: "z-ai/glm-4.6",
      requestID: 1,
      endpoints: [endpoint],
    })
    expect(endpointsEntry(scope("kilo", "z-ai/glm-4.6"))).toBeUndefined()
  })

  it("keeps cached lists visible and restarts in-flight requests when providers reload", () => {
    const { sent, post } = collect()

    requestEndpoints(scope("kilo", "z-ai/glm-4.6"), post)
    handleEndpointsMessage({
      type: "modelEndpointsLoaded",
      providerID: "kilo",
      modelID: "z-ai/glm-4.6",
      requestID: id(sent, 0),
      endpoints: [endpoint],
    })
    requestEndpoints(scope("kilo", "other/model"), post)
    expect(sent).toHaveLength(2)

    expect(
      handleEndpointsMessage({
        type: "providersLoaded",
        providers: {},
        connected: [],
        defaults: {},
        defaultSelection: { providerID: "kilo", modelID: "z-ai/glm-4.6" },
        authMethods: {},
        authStates: {},
      }),
    ).toBe(false)

    expect(endpointsEntry(scope("kilo", "z-ai/glm-4.6"))).toEqual({
      status: "ok",
      endpoints: [endpoint],
      at: expect.any(Number),
      stale: true,
    })

    // The in-flight request is restarted automatically. Its old response must
    // not replace data from the request made after the provider refresh.
    expect(sent).toHaveLength(3)

    handleEndpointsMessage({
      type: "modelEndpointsLoaded",
      providerID: "kilo",
      modelID: "other/model",
      requestID: id(sent, 1),
      endpoints: [endpoint],
    })
    expect(endpointsEntry(scope("kilo", "other/model"))).toBeUndefined()

    const current = { provider: "fast/fp8", name: "Current organization" }
    handleEndpointsMessage({
      type: "modelEndpointsLoaded",
      providerID: "kilo",
      modelID: "other/model",
      requestID: id(sent, 2),
      endpoints: [current],
    })
    expect(endpointsEntry(scope("kilo", "other/model"))).toEqual({
      status: "ok",
      endpoints: [current],
      at: expect.any(Number),
    })

    // Opening a stale cached model refreshes in the background without hiding
    // the cached endpoint list behind a loading state.
    requestEndpoints(scope("kilo", "z-ai/glm-4.6"), post)
    expect(sent).toHaveLength(4)
    expect(endpointsEntry(scope("kilo", "z-ai/glm-4.6"))).toEqual({
      status: "ok",
      endpoints: [endpoint],
      at: expect.any(Number),
      stale: true,
    })
  })

  it("refreshes expired cached results in the background", () => {
    const { sent, post } = collect()
    const orig = Date.now
    let t = 1_000_000
    Date.now = () => t
    try {
      requestEndpoints(scope("kilo", "z-ai/glm-4.6"), post)
      handleEndpointsMessage({
        type: "modelEndpointsLoaded",
        providerID: "kilo",
        modelID: "z-ai/glm-4.6",
        requestID: id(sent, 0),
        endpoints: [endpoint],
      })

      // Fresh cache — no refetch.
      requestEndpoints(scope("kilo", "z-ai/glm-4.6"), post)
      expect(sent).toHaveLength(1)

      // Expired cache — background refresh while the list stays visible.
      t += 6 * 60 * 1000
      requestEndpoints(scope("kilo", "z-ai/glm-4.6"), post)
      expect(sent).toHaveLength(2)
      expect(endpointsEntry(scope("kilo", "z-ai/glm-4.6"))).toEqual({
        status: "ok",
        endpoints: [endpoint],
        at: 1_000_000,
      })
    } finally {
      Date.now = orig
    }
  })

  it("drops cached catalogs and restarts in-flight requests when the account or organization changes", () => {
    const { sent, post } = collect()
    const profile = (email: string, org: string | null) => ({
      type: "profileData" as const,
      data: { profile: { email }, balance: null, kiloPass: null, currentOrgId: org },
    })

    expect(handleEndpointsMessage(profile("me@example.com", "org-a"))).toBe(false)
    requestEndpoints(scope("kilo", "z-ai/glm-4.6"), post)
    handleEndpointsMessage({
      type: "modelEndpointsLoaded",
      providerID: "kilo",
      modelID: "z-ai/glm-4.6",
      requestID: id(sent, 0),
      endpoints: [endpoint],
    })
    requestEndpoints(scope("kilo", "other/model"), post)
    expect(sent).toHaveLength(2)

    // Same identity again (profile refresh): nothing changes.
    handleEndpointsMessage(profile("me@example.com", "org-a"))
    expect(endpointsEntry(scope("kilo", "z-ai/glm-4.6"))).toMatchObject({ status: "ok", endpoints: [endpoint] })
    expect(sent).toHaveLength(2)

    // Organization switch: cached data is gone, not merely stale, and the
    // in-flight request is re-issued so its old response is ignored.
    handleEndpointsMessage(profile("me@example.com", "org-b"))
    expect(endpointsEntry(scope("kilo", "z-ai/glm-4.6"))).toBeUndefined()
    expect(sent).toHaveLength(3)
    handleEndpointsMessage({
      type: "modelEndpointsLoaded",
      providerID: "kilo",
      modelID: "other/model",
      requestID: id(sent, 1),
      endpoints: [endpoint],
    })
    expect(endpointsEntry(scope("kilo", "other/model"))).toBeUndefined()
    handleEndpointsMessage({
      type: "modelEndpointsLoaded",
      providerID: "kilo",
      modelID: "other/model",
      requestID: id(sent, 2),
      endpoints: [endpoint],
    })
    expect(endpointsEntry(scope("kilo", "other/model"))).toMatchObject({ status: "ok", endpoints: [endpoint] })

    // A failed refresh after the switch must not resurrect the old account's list.
    requestEndpoints(scope("kilo", "z-ai/glm-4.6"), post)
    handleEndpointsMessage({
      type: "modelEndpointsLoaded",
      providerID: "kilo",
      modelID: "z-ai/glm-4.6",
      requestID: id(sent, 3),
      endpoints: [],
      error: true,
    })
    expect(endpointsEntry(scope("kilo", "z-ai/glm-4.6"))).toEqual({ status: "error" })

    // Logout is an identity change too.
    handleEndpointsMessage(profile("me@example.com", "org-b"))
    expect(endpointsEntry(scope("kilo", "other/model"))).toMatchObject({ status: "ok" })
    handleEndpointsMessage({ type: "profileData", data: null })
    expect(endpointsEntry(scope("kilo", "other/model"))).toBeUndefined()
  })

  it("keeps catalogs requested before the first profile arrives", () => {
    const { sent, post } = collect()

    requestEndpoints(scope("kilo", "z-ai/glm-4.6"), post)
    handleEndpointsMessage({
      type: "modelEndpointsLoaded",
      providerID: "kilo",
      modelID: "z-ai/glm-4.6",
      requestID: id(sent, 0),
      endpoints: [endpoint],
    })
    handleEndpointsMessage({
      type: "profileData",
      data: { profile: { email: "me@example.com" }, balance: null, kiloPass: null, currentOrgId: null },
    })

    expect(endpointsEntry(scope("kilo", "z-ai/glm-4.6"))).toMatchObject({ status: "ok", endpoints: [endpoint] })
    expect(sent).toHaveLength(1)
  })

  it("keeps stale cached data when a background refresh fails", () => {
    const { sent, post } = collect()

    requestEndpoints(scope("kilo", "z-ai/glm-4.6"), post)
    handleEndpointsMessage({
      type: "modelEndpointsLoaded",
      providerID: "kilo",
      modelID: "z-ai/glm-4.6",
      requestID: id(sent, 0),
      endpoints: [endpoint],
    })
    handleEndpointsMessage({
      type: "providersLoaded",
      providers: {},
      connected: [],
      defaults: {},
      defaultSelection: { providerID: "kilo", modelID: "z-ai/glm-4.6" },
      authMethods: {},
      authStates: {},
    })

    requestEndpoints(scope("kilo", "z-ai/glm-4.6"), post)
    handleEndpointsMessage({
      type: "modelEndpointsLoaded",
      providerID: "kilo",
      modelID: "z-ai/glm-4.6",
      requestID: id(sent, 1),
      endpoints: [],
      error: true,
    })

    expect(endpointsEntry(scope("kilo", "z-ai/glm-4.6"))).toEqual({
      status: "ok",
      endpoints: [endpoint],
      at: expect.any(Number),
      stale: true,
    })
  })
})
