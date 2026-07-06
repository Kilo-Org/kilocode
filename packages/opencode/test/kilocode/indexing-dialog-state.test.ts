import { describe, expect, test } from "bun:test"
import { createEffect, createRoot, createSignal } from "solid-js"
import type { Config, IndexingConfig } from "@kilocode/sdk/v2"
import {
  createIndexingDialogState,
  currentKiloModel,
  indexingInheritance,
  indexingPatch,
  indexingScopeConfig,
  inheritedDescription,
  kiloModelOptions,
  loadKiloEmbeddingModels,
  mergeIndexingConfig,
  type IndexingScope,
} from "../../src/kilocode/components/indexing-dialog-state"

describe("indexing dialog state", () => {
  test.serial("loads Kilo models directly from the public catalog", async () => {
    const original = global.fetch
    const calls: string[] = []
    global.fetch = (async (input) => {
      calls.push(String(input))
      return new Response(
        JSON.stringify({
          defaultModel: "kilo/default",
          models: [{ id: "kilo/default", name: "Default", dimension: 1024, scoreThreshold: 0.35 }],
          aliases: {},
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    }) as typeof global.fetch

    try {
      const catalog = await loadKiloEmbeddingModels()

      expect(catalog.models).toHaveLength(1)
      expect(catalog.defaultModel).toBe("kilo/default")
      expect(calls).toHaveLength(1)
      expect(new URL(calls[0] ?? "https://invalid.test").pathname).toEndWith("/embedding-models")
    } finally {
      global.fetch = original
    }
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

  test("isolates global auth config from project indexing values", () => {
    const project: IndexingConfig = { kilo: { apiKey: "project-key", baseUrl: "https://project.test" } }
    const inherited: IndexingConfig = { enabled: true }
    const effective: Config = {
      provider: { kilo: { options: { apiKey: "provider-key" } } },
      indexing: project,
    }
    const global: Config = { provider: effective.provider, indexing: inherited }

    expect(indexingScopeConfig("global", effective, global, inherited)).toEqual(global)
    expect(indexingScopeConfig("project", effective, global, project)).toEqual(effective)
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
