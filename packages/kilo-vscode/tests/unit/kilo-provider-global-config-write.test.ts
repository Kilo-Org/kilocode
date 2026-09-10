import { afterAll, beforeEach, describe, expect, it, spyOn } from "bun:test"
import type { Config } from "@kilocode/sdk/v2/client"
import * as vscode from "vscode"
import { routingUnsetPaths, routingValue } from "../../src/shared/provider-routing"

// vscode mock is provided by the shared preload (tests/setup/vscode-mock.ts)
const { KiloProvider } = await import("../../src/KiloProvider")

type Internals = {
  connectionState: "connecting" | "connected" | "disconnected" | "error"
  writeGlobalConfig: (partial: Partial<Config>, unset?: string[][]) => Promise<void>
  fetchAndSendProviders: () => Promise<void>
  handleUpdateConfig: (...args: unknown[]) => Promise<unknown>
}

const notice = spyOn(vscode.window, "showErrorMessage").mockResolvedValue(undefined)
beforeEach(() => notice.mockClear())
afterAll(() => notice.mockRestore())

const target = (scope: "global" | "project", revision: string) => ({
  scope,
  path: scope === "global" ? "/config/kilo.jsonc" : "/repo/.kilo/kilo.jsonc",
  revision,
  exists: true,
  writable: true,
  raw: {},
})

// The overlay snapshot carries the live revision and a write must present
// exactly that revision — the backend rejects anything else, which is what the
// config binding guard relies on. Every accepted write produces a new revision.
function createConnection(options: { overlay?: () => Promise<unknown> } = {}) {
  const patches: Array<Record<string, unknown>> = []
  let revision = 1
  const targets = () => ({
    global: target("global", `global-r${revision}`),
    project: target("project", "project-live"),
  })
  const client = {
    global: { config: { get: async () => ({ data: {} }) } },
    config: {
      get: async () => ({ data: {} }),
      overlay: options.overlay ?? (async () => ({ data: { project: {}, targets: targets() } })),
      overlayUpdate: async (patch: Record<string, unknown> & { expected: { revision: string } }) => {
        if (patch.expected.revision !== `global-r${revision}`) throw new Error("Revision mismatch")
        revision++
        patches.push(patch)
        return { data: { effective: {}, targets: targets() } }
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

const pin = (provider: string) =>
  ({
    provider: { kilo: { models: { "z-ai/glm-4.6": { options: { provider: routingValue(provider) } } } } },
  }) as Partial<Config>

describe("KiloProvider.writeGlobalConfig", () => {
  it("writes a routing pin against a binding issued from a fresh snapshot", async () => {
    const conn = createConnection()
    const { internal, sent } = setup(conn)
    const partial = pin("gmicloud/fp8")

    await internal.writeGlobalConfig(partial)

    expect(conn.patches).toEqual([
      expect.objectContaining({
        scope: "global",
        set: partial,
        unset: [],
        expected: { path: "/config/kilo.jsonc", revision: "global-r1" },
      }),
    ])
    expect(sent.map((message) => message.type)).toEqual(["configUpdated"])
    expect(notice).not.toHaveBeenCalled()
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
        expected: expect.objectContaining({ revision: "global-r1" }),
      }),
    ])
    expect(sent.map((message) => message.type)).toEqual(["configUpdated"])
  })

  it("runs overlapping writes one after another, each against the latest revision", async () => {
    const conn = createConnection()
    const { internal, sent } = setup(conn)

    // Two picks in quick succession: without serialization both snapshots
    // would carry revision 1 and the second write would fail the guard.
    await Promise.all([internal.writeGlobalConfig(pin("gmicloud/fp8")), internal.writeGlobalConfig(pin("baseten/fp8"))])

    expect(conn.patches.map((patch) => [patch.set, (patch.expected as { revision: string }).revision])).toEqual([
      [pin("gmicloud/fp8"), "global-r1"],
      [pin("baseten/fp8"), "global-r2"],
    ])
    expect(sent.map((message) => message.type)).toEqual(["configUpdated", "configUpdated"])
    expect(notice).not.toHaveBeenCalled()
  })

  it("resolves once the config is written, without waiting for the provider refresh", async () => {
    const conn = createConnection()
    const { internal, sent } = setup(conn)
    Object.assign(internal, { fetchAndSendProviders: () => new Promise<void>(() => {}) })

    const outcome = await Promise.race([
      internal.writeGlobalConfig(pin("gmicloud/fp8")).then(() => "written"),
      new Promise<string>((resolve) => setTimeout(() => resolve("timed out"), 1000)),
    ])

    expect(outcome).toBe("written")
    expect(conn.patches).toHaveLength(1)
    expect(sent.map((message) => message.type)).toEqual(["configUpdated"])
  })

  it("reports a failure instead of writing when the backend is not connected", async () => {
    const conn = createConnection()
    const { internal, sent } = setup(conn, false)

    await internal.writeGlobalConfig({ model: "kilo/test" })

    expect(conn.patches).toEqual([])
    expect(sent).toEqual([{ type: "configUpdateFailed", message: "Not connected to CLI backend" }])
    expect(notice).toHaveBeenCalledWith("Config update failed: Not connected to CLI backend")
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
    expect(notice).toHaveBeenCalledWith("Config update failed: overlay unavailable")
  })

  it("surfaces a rejected write, then keeps accepting later writes", async () => {
    const stale = { global: target("global", "global-r0"), project: target("project", "project-live") }
    const conn = createConnection({ overlay: async () => ({ data: { project: {}, targets: stale } }) })
    const { internal, sent } = setup(conn)

    await internal.writeGlobalConfig(pin("gmicloud/fp8"))

    expect(conn.patches).toEqual([])
    expect(sent).toEqual([expect.objectContaining({ type: "configUpdateFailed", message: "Revision mismatch" })])
    expect(notice).toHaveBeenCalledWith("Config update failed: Revision mismatch")

    // A queued write after a failure still runs.
    await internal.writeGlobalConfig(pin("baseten/fp8"))
    expect(sent.map((message) => message.type)).toEqual(["configUpdateFailed", "configUpdateFailed"])
  })

  it("reports a throw inside the write like a rejected write, then keeps accepting later writes", async () => {
    const conn = createConnection()
    const { internal, sent } = setup(conn)
    const write = internal.handleUpdateConfig.bind(internal)
    Object.assign(internal, {
      handleUpdateConfig: async () => {
        throw new Error("boom")
      },
    })

    await internal.writeGlobalConfig(pin("gmicloud/fp8"))

    expect(conn.patches).toEqual([])
    expect(sent).toEqual([expect.objectContaining({ type: "configUpdateFailed", message: "boom" })])
    expect(notice).toHaveBeenCalledWith("Config update failed: boom")

    Object.assign(internal, { handleUpdateConfig: write })
    await internal.writeGlobalConfig(pin("baseten/fp8"))
    expect(conn.patches).toHaveLength(1)
    expect(sent.map((message) => message.type)).toEqual(["configUpdateFailed", "configUpdated"])
  })
})
