import { describe, expect, test } from "bun:test"
import type { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import type { KiloIndexingRpc } from "@opencode/schema/kilocode/indexing"
import { createEffect, createRoot, createSignal } from "solid-js"
import {
  createIndexingDialogState,
  currentKiloModel,
  indexingInheritance,
  indexingPatch,
  inheritedDescription,
  kiloModelOptions,
  loadKiloEmbeddingModels,
  mergeIndexingConfig,
  shouldDefaultIndexingToKilo,
  type IndexingScope,
} from "../../src/kilocode/indexing-dialog-state"

type IndexingConfig = KiloIndexingRpc.Config
type KiloEmbeddingModelCatalog = KiloGatewayRpc.EmbeddingCatalog

describe("indexing dialog state", () => {
  test("loads Kilo models through the catalog loader", async () => {
    const catalog: KiloEmbeddingModelCatalog = {
      defaultModel: "kilo/default",
      models: [{ id: "kilo/default", name: "Default", dimension: 1024, scoreThreshold: 0.35 }],
      aliases: {},
    }
    let calls = 0

    const loaded = await loadKiloEmbeddingModels(async () => {
      calls += 1
      return catalog
    })

    expect(loaded).toBe(catalog)
    expect(calls).toBe(1)
  })

  test("reports a catalog failure message", async () => {
    const messages: string[] = []

    await expect(
      loadKiloEmbeddingModels(
        async () => {
          throw new Error("Catalog offline")
        },
        (message) => messages.push(message),
      ),
    ).rejects.toThrow("Catalog offline")
    expect(messages).toEqual(["Catalog offline"])
  })

  test("builds stable loading, empty, and loaded model options", () => {
    expect(kiloModelOptions()).toEqual([{ value: "", title: "Loading supported models..." }])
    expect(kiloModelOptions({ defaultModel: "", models: [], aliases: {} })).toEqual([
      { value: "", title: "No supported models available" },
    ])

    const catalog = {
      defaultModel: "provider/default",
      models: [
        { id: "provider/default", name: "Default", dimension: 1024, scoreThreshold: 0.35 },
        { id: "provider/code", name: "Code", dimension: 1536, scoreThreshold: 0.4, note: "code" },
      ],
      aliases: { code: "provider/code" },
    }

    expect(kiloModelOptions(catalog)).toEqual([
      { value: "provider/default", title: "Default (1024d)" },
      { value: "provider/code", title: "Code (code, 1536d)" },
    ])
    expect(currentKiloModel(catalog, "code")).toBe("provider/code")
    expect(currentKiloModel(catalog, "missing")).toBe("provider/default")
  })

  test("classifies scalar and partial nested inheritance", () => {
    const global: IndexingConfig = {
      provider: "openai-compatible",
      model: "global-model",
      dimension: 1024,
      "openai-compatible": { baseUrl: "https://global.test", apiKey: "global-secret" },
    }
    const project: IndexingConfig = {
      model: null,
      "openai-compatible": { baseUrl: "https://project.test" },
    }

    expect(indexingInheritance("project", global, project, [["provider"]])).toBe("inherited")
    expect(indexingInheritance("project", global, project, [["model"]])).toBe("none")
    expect(indexingInheritance("project", global, project, [["dimension"]])).toBe("inherited")
    expect(
      indexingInheritance("project", global, project, [
        ["openai-compatible", "baseUrl"],
        ["openai-compatible", "apiKey"],
      ]),
    ).toBe("partial")
    expect(indexingInheritance("global", global, project, [["provider"]])).toBe("none")
    expect(inheritedDescription("OpenAI-Compatible", "inherited")).toBe("OpenAI-Compatible (inherited)")
    expect(inheritedDescription("configured", "partial")).toBe("configured (partially inherited)")
  })

  test("does not classify built-in defaults as inherited", () => {
    expect(indexingInheritance("project", {}, {}, [["vectorStore"]])).toBe("none")
    expect(indexingInheritance("project", {}, {}, [["searchMinScore"]])).toBe("none")
  })

  test("reveals the inherited tuning value after clearing a project override", () => {
    const global: IndexingConfig = { searchMinScore: 0.4, qdrant: { url: "http://global", apiKey: "secret" } }
    const project: IndexingConfig = { searchMinScore: undefined, qdrant: { url: "http://project", apiKey: undefined } }

    expect(mergeIndexingConfig(global, project)).toMatchObject({
      searchMinScore: 0.4,
      qdrant: { url: "http://project", apiKey: "secret" },
    })
    expect(indexingInheritance("project", global, project, [["searchMinScore"]])).toBe("inherited")
  })

  test("replaces inherited file extensions with a project allowlist", () => {
    const global: IndexingConfig = { fileExtensions: [".ts", ".tsx"] }
    const project: IndexingConfig = { fileExtensions: [".php"] }

    expect(mergeIndexingConfig(global, project).fileExtensions).toEqual([".php"])
    expect(indexingInheritance("project", global, {}, [["fileExtensions"]])).toBe("inherited")
    expect(indexingInheritance("project", global, project, [["fileExtensions"]])).toBe("none")
  })

  test("defaults an unconfigured provider to Kilo when credentials exist", () => {
    expect(shouldDefaultIndexingToKilo({ enabled: true }, true)).toBe(true)
    expect(shouldDefaultIndexingToKilo({ enabled: true }, false)).toBe(false)
    expect(shouldDefaultIndexingToKilo({ provider: "openai" }, true)).toBe(false)
    expect(shouldDefaultIndexingToKilo({ openai: { apiKey: "sk-test" } }, true)).toBe(false)
    expect(shouldDefaultIndexingToKilo({ openai: {} }, true)).toBe(true)
  })

  test("unsets cleared nested values without persisting undefined", () => {
    expect(
      indexingPatch(
        { qdrant: { url: "http://localhost:6333", apiKey: "secret" }, searchMinScore: 0.4 },
        { qdrant: { url: "http://localhost:6333", apiKey: undefined }, searchMinScore: undefined },
      ),
    ).toEqual({
      indexing: { qdrant: { url: "http://localhost:6333" } },
      unset: [
        ["indexing", "qdrant", "apiKey"],
        ["indexing", "searchMinScore"],
      ],
    })
  })

  test("reacts when the project overlay loads", () => {
    const [scope, setScope] = createSignal<IndexingScope>("project")
    const [global, setGlobal] = createSignal<IndexingConfig>({ enabled: true, provider: "openai" })
    const [project, setProject] = createSignal<IndexingConfig>({})
    const seen: IndexingConfig[] = []

    const dispose = createRoot((dispose) => {
      const state = createIndexingDialogState({ scope, global, project, resolve: (config) => config })
      createEffect(() => seen.push(state.config()))
      return dispose
    })

    setProject({ enabled: false, provider: "ollama" })
    setScope("global")
    setGlobal({ enabled: false, provider: "gemini" })

    expect(seen).toEqual([
      { enabled: true, provider: "openai" },
      { enabled: false, provider: "ollama" },
      { enabled: true, provider: "openai" },
      { enabled: false, provider: "gemini" },
    ])
    dispose()
  })

  test("resolves selected-scope values and inheritance", () => {
    const [scope, setScope] = createSignal<IndexingScope>("project")
    const [global] = createSignal<IndexingConfig>({
      enabled: true,
      provider: "openai",
      openai: { apiKey: "global" },
      qdrant: { url: "http://global", apiKey: "global-secret" },
    })
    const [project, setProject] = createSignal<IndexingConfig>({ qdrant: { url: "http://project" } })

    const result = createRoot((dispose) => {
      const state = createIndexingDialogState({ scope, global, project, resolve: (config) => config })
      return { state, dispose }
    })

    expect(result.state.enabled()).toBe(true)
    expect(result.state.inherited([["enabled"]])).toBe("inherited")
    expect(result.state.config()).toEqual({
      enabled: true,
      provider: "openai",
      openai: { apiKey: "global" },
      qdrant: { url: "http://project", apiKey: "global-secret" },
    })

    setProject({ enabled: false })
    expect(result.state.enabled()).toBe(false)
    expect(result.state.inherited([["enabled"]])).toBe("none")

    setScope("global")
    expect(result.state.enabled()).toBe(true)
    expect(result.state.inherited([["enabled"]])).toBe("none")
    result.dispose()
  })
})
