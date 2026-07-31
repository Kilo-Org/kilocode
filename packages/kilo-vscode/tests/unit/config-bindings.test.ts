import { describe, expect, it } from "bun:test"
import { ConfigBindings, type ConfigProject } from "../../src/kilo-provider/config-bindings"

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
})
