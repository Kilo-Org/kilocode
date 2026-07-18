import { describe, expect, test } from "bun:test"
import {
  ProjectRegistryStore,
  PROJECT_REGISTRY_STORAGE_KEY,
  ProjectRegistryStoreCorrupt,
} from "../../src/agent-manager/project-registry-store"
import { makeMemento } from "./_helpers/memento"

describe("ProjectRegistryStore", () => {
  test("storage key names the slot used in extension globalState", () => {
    expect(PROJECT_REGISTRY_STORAGE_KEY).toBe("kilo.agentManager.projectRegistry.v1")
  })

  test("load returns an empty registry when no value is stored", async () => {
    const memento = makeMemento()
    const store = new ProjectRegistryStore(memento)
    expect(await store.load()).toEqual({ version: 1, projects: [] })
  })

  test("save then load round-trips a populated registry", async () => {
    const memento = makeMemento()
    const writer = new ProjectRegistryStore(memento)
    await writer.save({
      version: 1,
      projects: [
        {
          id: "f64e3a9b8c1d2705",
          root: "/Users/me/code/kilocode",
          order: 0,
          collapsed: false,
          trusted: false,
        },
      ],
      activeProjectId: "f64e3a9b8c1d2705",
    })

    const reader = new ProjectRegistryStore(memento)
    expect(await reader.load()).toEqual({
      version: 1,
      projects: [
        {
          id: "f64e3a9b8c1d2705",
          root: "/Users/me/code/kilocode",
          order: 0,
          collapsed: false,
          trusted: false,
        },
      ],
      activeProjectId: "f64e3a9b8c1d2705",
    })
  })

  test("load throws ProjectRegistryStoreCorrupt for malformed JSON", async () => {
    const memento = makeMemento()
    memento.seed({ [PROJECT_REGISTRY_STORAGE_KEY]: "{not json" })
    const store = new ProjectRegistryStore(memento)
    await expect(store.load()).rejects.toBeInstanceOf(ProjectRegistryStoreCorrupt)
  })

  test("load throws ProjectRegistryStoreCorrupt for an unrecognized schema version", async () => {
    const memento = makeMemento()
    memento.seed({
      [PROJECT_REGISTRY_STORAGE_KEY]: JSON.stringify({ version: 99, projects: [] }),
    })
    const store = new ProjectRegistryStore(memento)
    await expect(store.load()).rejects.toBeInstanceOf(ProjectRegistryStoreCorrupt)
  })

  test("save persists the registry under the project-registry v1 key", async () => {
    const memento = makeMemento()
    const store = new ProjectRegistryStore(memento)
    await store.save({ version: 1, projects: [], activeProjectId: "abc" })
    expect(memento.read(PROJECT_REGISTRY_STORAGE_KEY)).toBe(
      JSON.stringify({ version: 1, projects: [], activeProjectId: "abc" }),
    )
  })

  test("clear removes the entry from storage", async () => {
    const memento = makeMemento()
    const store = new ProjectRegistryStore(memento)
    await store.save({ version: 1, projects: [] })
    await store.clear()
    expect(memento.read(PROJECT_REGISTRY_STORAGE_KEY)).toBeUndefined()
  })
})
