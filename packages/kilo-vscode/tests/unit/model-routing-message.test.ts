import { describe, expect, it } from "bun:test"
import { routeModelRoutingMessage, type ModelRoutingContext } from "../../src/kilo-provider/model-routing"
import { routingUnsetPaths, routingValue } from "../../src/shared/provider-routing"
import { KILO_PROVIDER_ID } from "../../src/shared/provider-model"
import type { Config, KiloClient } from "@kilocode/sdk/v2/client"

// The gateway provider ID selects the catalog, so it comes from the constant the
// router compares against — the "kilo" catalog name below is unrelated to it.
const pid = KILO_PROVIDER_ID
const mid = "z-ai/glm-4.6"

type EndpointsCall = { model: string; catalog: string; directory: string }
type ConfigCall = { partial: Partial<Config>; unset: string[][] | undefined }
type WorkspaceCall = { kind: "get" | "overlay"; directory: string; scope?: string }

// Sessions resolve to their own workspace directory; without one the settings
// scope applies — the shape KiloProvider hands to the router.
const directories: Record<string, string> = { ses_tree: "/worktree" }
const settingsDir = "/root"

function harness(
  endpoints?: (call: EndpointsCall) => Promise<{ data: unknown[] }>,
  workspace?: (call: WorkspaceCall) => Promise<{ data: unknown }>,
) {
  const posted: Record<string, unknown>[] = []
  const configCalls: ConfigCall[] = []
  const endpointCalls: EndpointsCall[] = []
  const workspaceCalls: WorkspaceCall[] = []

  const client =
    endpoints || workspace
      ? ({
          kilo: {
            models: {
              endpoints: (params: EndpointsCall) => {
                endpointCalls.push(params)
                if (!endpoints) throw new Error("unexpected endpoints call")
                return endpoints(params)
              },
            },
          },
          config: {
            get: (params: { directory: string }) => {
              const call = { kind: "get" as const, directory: params.directory }
              workspaceCalls.push(call)
              if (!workspace) throw new Error("unexpected config call")
              return workspace(call)
            },
            overlay: (params: { directory: string; scope: string }) => {
              const call = { kind: "overlay" as const, directory: params.directory, scope: params.scope }
              workspaceCalls.push(call)
              if (!workspace) throw new Error("unexpected config call")
              return workspace(call)
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
    directory: (sessionID) => (sessionID ? (directories[sessionID] ?? settingsDir) : settingsDir),
  }
  return { ctx, posted, configCalls, endpointCalls, workspaceCalls }
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
      { model: mid, catalog: "kilo", directory: settingsDir },
      { model: mid, catalog: "public", directory: settingsDir },
    ])
    expect(posted).toEqual([
      {
        type: "modelEndpointsLoaded",
        providerID: pid,
        modelID: mid,
        requestID: 1,
        directory: settingsDir,
        endpoints: [{ provider: "gmicloud/fp8" }],
      },
      {
        type: "modelEndpointsLoaded",
        providerID: "openrouter",
        modelID: mid,
        requestID: 2,
        directory: settingsDir,
        endpoints: [{ provider: "gmicloud/fp8" }],
      },
    ])
  })

  it("resolves the catalog in the originating session's workspace", async () => {
    const { ctx, posted, endpointCalls } = harness(async () => ({ data: [] }))

    await routeModelRoutingMessage(
      { type: "requestModelEndpoints", providerID: pid, modelID: mid, requestID: 4, sessionID: "ses_tree" },
      ctx,
    )
    await drain()

    expect(endpointCalls).toEqual([{ model: mid, catalog: "kilo", directory: "/worktree" }])
    expect(posted).toEqual([
      {
        type: "modelEndpointsLoaded",
        providerID: pid,
        modelID: mid,
        requestID: 4,
        directory: "/worktree",
        endpoints: [],
      },
    ])
  })

  it("loads a session workspace's effective config and its project file", async () => {
    const config = { model: "kilo/z-ai/glm-4.6" }
    const project = { provider: { [pid]: { models: { [mid]: { options: { provider: { only: ["baseten/fp8"] } } } } } } }
    const { ctx, posted, workspaceCalls } = harness(undefined, async (call) =>
      call.kind === "get" ? { data: config } : { data: { targets: { project: { raw: project } } } },
    )

    expect(
      await routeModelRoutingMessage({ type: "requestWorkspaceConfig", requestID: 5, sessionID: "ses_tree" }, ctx),
    ).toBe(true)
    await drain()

    expect(workspaceCalls).toEqual([
      { kind: "get", directory: "/worktree" },
      { kind: "overlay", directory: "/worktree", scope: "project" },
    ])
    expect(posted).toEqual([
      { type: "workspaceConfigLoaded", requestID: 5, directory: "/worktree", config, projectConfig: project },
    ])
  })

  it("reports a failed workspace config lookup", async () => {
    const offline = harness()
    await routeModelRoutingMessage({ type: "requestWorkspaceConfig", requestID: 6 }, offline.ctx)
    expect(offline.posted).toEqual([
      { type: "workspaceConfigLoaded", requestID: 6, directory: settingsDir, config: {}, error: true },
    ])

    const failing = harness(undefined, async () => {
      throw new Error("boom")
    })
    await routeModelRoutingMessage({ type: "requestWorkspaceConfig", requestID: 7, sessionID: "ses_tree" }, failing.ctx)
    await drain()
    expect(failing.posted).toEqual([
      { type: "workspaceConfigLoaded", requestID: 7, directory: "/worktree", config: {}, error: true },
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
      {
        type: "modelEndpointsLoaded",
        providerID: pid,
        modelID: mid,
        requestID: 3,
        directory: settingsDir,
        endpoints: [],
        error: true,
      },
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
    expect(await routeModelRoutingMessage({ type: "requestWorkspaceConfig", requestID: "7" }, ctx)).toBe(true)
    expect(configCalls).toEqual([])
    expect(posted).toEqual([])
  })
})
