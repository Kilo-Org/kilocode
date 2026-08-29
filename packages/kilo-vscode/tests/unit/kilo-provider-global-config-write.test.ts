import { describe, expect, it } from "bun:test"
import type { Config } from "@kilocode/sdk/v2/client"
import { routingUnsetPaths, routingValue } from "../../src/shared/provider-routing"

// vscode mock is provided by the shared preload (tests/setup/vscode-mock.ts)
const { KiloProvider } = await import("../../src/KiloProvider")

type Internals = {
  connectionState: "connecting" | "connected" | "disconnected" | "error"
  writeGlobalConfig: (partial: Partial<Config>, unset?: string[][]) => Promise<void>
  fetchAndSendProviders: () => Promise<void>
}

const target = (scope: "global" | "project", revision: string) => ({
  scope,
  path: scope === "global" ? "/config/kilo.jsonc" : "/repo/.kilo/kilo.jsonc",
  revision,
  exists: true,
  writable: true,
  raw: {},
})

// The overlay snapshot carries the live revision; a write must present exactly
// that revision, which is what the config binding guard checks.
function createConnection(options: { overlay?: () => Promise<unknown> } = {}) {
  const patches: Array<Record<string, unknown>> = []
  const live = { global: target("global", "global-live"), project: target("project", "project-live") }
  const written = {
    effective: {},
    targets: { global: target("global", "global-written"), project: target("project", "project-live") },
  }
  const client = {
    global: { config: { get: async () => ({ data: {} }) } },
    config: {
      get: async () => ({ data: {} }),
      overlay: options.overlay ?? (async () => ({ data: { project: {}, targets: live } })),
      overlayUpdate: async (patch: Record<string, unknown>) => {
        patches.push(patch)
        return { data: written }
      },
    },
    experimental: { capabilities: { get: async () => ({ data: {} }) } },
  }
  return {
    patches,
    service: { drainPendingPrompts: async () => {}, getClient: () => client },
  }
}

function setup(conn: ReturnType<typeof createConnection>, connected = true) {
  const provider = new KiloProvider({} as never, conn.service as never)
  const internal = provider as unknown as Internals
  const sent: Array<Record<string, unknown>> = []
  provider.postMessage = (message) => void sent.push(message as Record<string, unknown>)
  Object.assign(internal, {
    connectionState: connected ? "connected" : "disconnected",
    commitMessageLanguageSetting: () => "sync",
    fetchAndSendProviders: async () => {},
  })
  return { internal, sent }
}

describe("KiloProvider.writeGlobalConfig", () => {
  it("writes a routing pin against a binding issued from a fresh snapshot", async () => {
    const conn = createConnection()
    const { internal, sent } = setup(conn)
    const partial = {
      provider: { kilo: { models: { "z-ai/glm-4.6": { options: { provider: routingValue("gmicloud/fp8") } } } } },
    } as Partial<Config>

    await internal.writeGlobalConfig(partial)

    expect(conn.patches).toEqual([
      expect.objectContaining({
        scope: "global",
        set: partial,
        unset: [],
        expected: { path: "/config/kilo.jsonc", revision: "global-live" },
      }),
    ])
    expect(sent.map((message) => message.type)).toEqual(["configUpdated"])
  })

  it("clears a routing pin through the same guarded write", async () => {
    const conn = createConnection()
    const { internal, sent } = setup(conn)
    const unset = routingUnsetPaths("kilo", "z-ai/glm-4.6")

    await internal.writeGlobalConfig({}, unset)

    expect(conn.patches).toEqual([
      expect.objectContaining({
        scope: "global",
        set: {},
        unset,
        expected: expect.objectContaining({ revision: "global-live" }),
      }),
    ])
    expect(sent.map((message) => message.type)).toEqual(["configUpdated"])
  })

  it("reports a failure instead of writing when the backend is not connected", async () => {
    const conn = createConnection()
    const { internal, sent } = setup(conn, false)

    await internal.writeGlobalConfig({ model: "kilo/test" })

    expect(conn.patches).toEqual([])
    expect(sent).toEqual([{ type: "configUpdateFailed", message: "Not connected to CLI backend" }])
  })

  it("reports a failure instead of writing when the snapshot cannot be loaded", async () => {
    const conn = createConnection({
      overlay: async () => {
        throw new Error("overlay unavailable")
      },
    })
    const { internal, sent } = setup(conn)

    await internal.writeGlobalConfig({ model: "kilo/test" })

    expect(conn.patches).toEqual([])
    expect(sent).toEqual([expect.objectContaining({ type: "configUpdateFailed", message: "overlay unavailable" })])
  })
})
