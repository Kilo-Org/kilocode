import { describe, expect, it } from "bun:test"
import { routeModelRoutingMessage, type ModelRoutingContext } from "../../src/kilo-provider/model-routing"
import { routingUnsetPaths, routingValue } from "../../src/shared/provider-routing"
import { KILO_PROVIDER_ID } from "../../src/shared/provider-model"
import type { Config, KiloClient } from "@kilocode/sdk/v2/client"

// The gateway provider ID selects the catalog, so it comes from the constant the
// router compares against — the "kilo" catalog name below is unrelated to it.
const pid = KILO_PROVIDER_ID
const mid = "z-ai/glm-4.6"

type EndpointsCall = { model: string; catalog: string }
type ConfigCall = { partial: Partial<Config>; unset: string[][] | undefined }

function harness(endpoints?: (call: EndpointsCall) => Promise<{ data: unknown[] }>) {
  const posted: Record<string, unknown>[] = []
  const configCalls: ConfigCall[] = []
  const endpointCalls: EndpointsCall[] = []

  const client = endpoints
    ? ({
        kilo: {
          models: {
            endpoints: (params: EndpointsCall) => {
              endpointCalls.push(params)
              return endpoints(params)
            },
          },
        },
      } as unknown as KiloClient)
    : null

  const ctx: ModelRoutingContext = {
    client,
    post: (message) => posted.push(message as Record<string, unknown>),
    updateConfig: async (partial, unset) => {
      configCalls.push({ partial, unset })
    },
  }
  return { ctx, posted, configCalls, endpointCalls }
}

// The endpoint request is fire-and-forget, so let its promise chain drain.
const drain = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("provider routing message router", () => {
  it("ignores unrelated messages", async () => {
    const { ctx, posted, configCalls } = harness()
    expect(await routeModelRoutingMessage({ type: "persistRecents" }, ctx)).toBe(false)
    expect(posted).toEqual([])
    expect(configCalls).toEqual([])
  })

  it("requests the kilo catalog for gateway models and the public one otherwise", async () => {
    const { ctx, posted, endpointCalls } = harness(async () => ({ data: [{ provider: "gmicloud/fp8" }] }))

    expect(
      await routeModelRoutingMessage(
        { type: "requestModelEndpoints", providerID: pid, modelID: mid, requestID: 1 },
        ctx,
      ),
    ).toBe(true)
    expect(
      await routeModelRoutingMessage(
        { type: "requestModelEndpoints", providerID: "openrouter", modelID: mid, requestID: 2 },
        ctx,
      ),
    ).toBe(true)
    await drain()

    expect(endpointCalls).toEqual([
      { model: mid, catalog: "kilo" },
      { model: mid, catalog: "public" },
    ])
    expect(posted).toEqual([
      {
        type: "modelEndpointsLoaded",
        providerID: pid,
        modelID: mid,
        requestID: 1,
        endpoints: [{ provider: "gmicloud/fp8" }],
      },
      {
        type: "modelEndpointsLoaded",
        providerID: "openrouter",
        modelID: mid,
        requestID: 2,
        endpoints: [{ provider: "gmicloud/fp8" }],
      },
    ])
  })

  it("reports an error when the backend is unavailable", async () => {
    const { ctx, posted } = harness()
    await routeModelRoutingMessage({ type: "requestModelEndpoints", providerID: pid, modelID: mid, requestID: 7 }, ctx)
    expect(posted).toEqual([
      { type: "modelEndpointsLoaded", providerID: pid, modelID: mid, requestID: 7, endpoints: [], error: true },
    ])
  })

  it("reports an error when the endpoint request fails", async () => {
    const { ctx, posted } = harness(async () => {
      throw new Error("boom")
    })
    await routeModelRoutingMessage({ type: "requestModelEndpoints", providerID: pid, modelID: mid, requestID: 3 }, ctx)
    await drain()
    expect(posted).toEqual([
      { type: "modelEndpointsLoaded", providerID: pid, modelID: mid, requestID: 3, endpoints: [], error: true },
    ])
  })

  it("persists a pinned endpoint into the global config", async () => {
    const { ctx, configCalls } = harness()
    expect(
      await routeModelRoutingMessage(
        { type: "persistModelRouting", providerID: pid, modelID: mid, provider: "gmicloud/fp8" },
        ctx,
      ),
    ).toBe(true)
    expect(configCalls).toEqual([
      {
        partial: {
          provider: { [pid]: { models: { [mid]: { options: { provider: routingValue("gmicloud/fp8") } } } } },
        } as Partial<Config>,
        unset: undefined,
      },
    ])
  })

  it("clears only the owned fields when routing is reset to auto", async () => {
    const { ctx, configCalls } = harness()
    await routeModelRoutingMessage({ type: "persistModelRouting", providerID: pid, modelID: mid, provider: null }, ctx)
    expect(configCalls).toEqual([{ partial: {}, unset: routingUnsetPaths(pid, mid) }])
  })

  it("swallows malformed payloads without touching the config", async () => {
    const { ctx, posted, configCalls } = harness()
    expect(await routeModelRoutingMessage({ type: "persistModelRouting", providerID: pid }, ctx)).toBe(true)
    expect(await routeModelRoutingMessage({ type: "requestModelEndpoints", providerID: pid, modelID: mid }, ctx)).toBe(
      true,
    )
    expect(configCalls).toEqual([])
    expect(posted).toEqual([])
  })
})
