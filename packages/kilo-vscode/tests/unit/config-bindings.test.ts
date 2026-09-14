import { describe, expect, it } from "bun:test"
import { ConfigBindings, type ConfigBinding, type ConfigProject } from "../../src/kilo-provider/config-bindings"

const { KiloProvider } = await import("../../src/KiloProvider")

const target = {
  scope: "project" as const,
  path: "/repo/.kilo/kilo.jsonc",
  revision: "revision",
  exists: false,
  writable: true,
  raw: {},
}

describe("ConfigBindings", () => {
  it("keeps the read-time directory and target immutable", () => {
    const bindings = new ConfigBindings()
    const binding = bindings.create({
      connection: 1,
      scope: "project",
      directory: "/repo/a",
      target,
      project: { id: "a", root: "/repo/a", generation: 2, pinned: false },
    })

    expect(bindings.get(binding.id, 1, () => true)).toMatchObject({
      directory: "/repo/a",
      target: { path: target.path, revision: target.revision },
    })
  })

  it("expires on reconnect, trust revocation, removal, or successful save", () => {
    const bindings = new ConfigBindings()
    const project: ConfigProject = { id: "a", root: "/repo/a", generation: 2, pinned: false }
    const binding = bindings.create({ connection: 1, scope: "project", directory: project.root, target, project })

    expect(bindings.get(binding.id, 2, () => true)).toBeUndefined()
    expect(bindings.get(binding.id, 1, () => false)).toBeUndefined()
    expect(bindings.get(binding.id, 1, () => true)).toBeDefined()
    bindings.consume(binding.id)
    expect(bindings.get(binding.id, 1, () => true)).toBeUndefined()
  })

  it("expires retained-panel bindings when the selected project changes", () => {
    const provider = new KiloProvider({} as never, {} as never, undefined, { projectDirectory: "/repo/a" })
    const internal = provider as unknown as { configBindings: ConfigBindings; connectionGeneration: number }
    const binding = internal.configBindings.create({
      connection: internal.connectionGeneration,
      scope: "global",
      directory: "/repo/a",
      target: { ...target, scope: "global" },
    })

    provider.setProjectDirectory("/repo/b")

    expect(internal.configBindings.get(binding.id, internal.connectionGeneration, () => true)).toBeUndefined()
  })

  it("publishes valid save bindings after a concurrent refresh during capability loading", async () => {
    const started = Promise.withResolvers<void>()
    const capabilities = Promise.withResolvers<{ data: { backgroundSubagents: boolean } }>()
    const global = { ...target, scope: "global" as const }
    const client = {
      config: {
        overlayUpdate: async () => ({ data: { effective: {}, targets: { global, project: target } } }),
      },
      experimental: {
        capabilities: {
          get: () => {
            started.resolve()
            return capabilities.promise
          },
        },
      },
    }
    const provider = new KiloProvider(
      {} as never,
      { getClient: () => client, drainPendingPrompts: async () => {} } as never,
      undefined,
      { projectDirectory: "/repo/a" },
    )
    const internal = provider as unknown as {
      configBindings: ConfigBindings
      connectionGeneration: number
      connectionState: string
      configSettings: () => Record<string, unknown>
      fetchAndSendProviders: () => Promise<void>
      handleUpdateConfig: (
        config: { disabled_providers: string[] },
        project: object,
        globalUnset: string[][],
        projectUnset: string[][],
        binding: string,
      ) => Promise<void>
    }
    internal.connectionState = "connected"
    internal.configSettings = () => ({})
    internal.fetchAndSendProviders = async () => {}
    const input = {
      connection: internal.connectionGeneration,
      scope: "global" as const,
      directory: "/repo/a",
      target: global,
    }
    const binding = internal.configBindings.create(input)
    const published: ConfigBinding[] = []
    provider.postMessage = (message) => {
      if (message.type === "configUpdated" && message.bindings?.global)
        published.push(message.bindings.global as ConfigBinding)
    }

    const saving = internal.handleUpdateConfig({ disabled_providers: [] }, {}, [], [], binding.id)
    await started.promise
    internal.configBindings.create(input)
    capabilities.resolve({ data: { backgroundSubagents: false } })
    await saving

    expect(published).toHaveLength(1)
    expect(internal.configBindings.get(published.at(0)?.id, internal.connectionGeneration, () => true)).toBeDefined()
  })
})
