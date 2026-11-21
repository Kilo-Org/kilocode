import { describe, expect, test } from "bun:test"
import { clean, merge, parseFileExtensions, providerPatch, removed, shouldSync, validate } from "./indexing"

describe("indexing config state", () => {
  test("merges project settings over nested global settings", () => {
    expect(
      merge(
        { enabled: true, provider: "openai", openai: { apiKey: "global" }, qdrant: { url: "http://global" } },
        { enabled: false, provider: "ollama", qdrant: { apiKey: "project" } },
      ),
    ).toEqual({
      enabled: false,
      provider: "ollama",
      openai: { apiKey: "global" },
      qdrant: { url: "http://global", apiKey: "project" },
    })
  })

  test("cleans empty fields and returns unset paths", () => {
    const before = {
      provider: "openai" as const,
      model: "text-embedding-3-small",
      openai: { apiKey: "secret" },
    }
    const after = clean({ provider: "openai", model: "", openai: { apiKey: "" } })

    expect(after).toEqual({ provider: "openai" })
    expect(removed(before, after)).toEqual([
      ["indexing", "model"],
      ["indexing", "openai"],
    ])
  })

  test("resyncs dirty drafts when the scope changes", () => {
    expect(shouldSync("global", "global", true, "global", "updated")).toBe(false)
    expect(shouldSync("global", "project", true, "global", "project")).toBe(true)
    expect(shouldSync("global", "project", true, "shared", "shared")).toBe(true)
  })

  test("preserves empty prompt overrides when saving an unrelated indexing change", () => {
    const before = {
      provider: "openai-compatible" as const,
      "openai-compatible": { baseUrl: "http://localhost:8080/v1", documentPrompt: "", queryPrompt: "" },
    }
    const after = clean(merge(before, { searchMaxResults: 25 }))

    expect(after).toEqual({ ...before, searchMaxResults: 25 })
    expect(removed(before, after)).toEqual([])
  })

  test("retains prompt-only options and exact prompt names while pruning empty connection settings", () => {
    expect(clean({ "openai-compatible": { documentPrompt: "", queryPrompt: "", apiKey: " " } })).toEqual({
      "openai-compatible": { documentPrompt: "", queryPrompt: "" },
    })
    expect(
      clean({
        model: " ",
        "openai-compatible": {
          baseUrl: " http://localhost:8080/v1 ",
          documentPrompt: " document ",
          queryPrompt: "CodeRetrieval",
          apiKey: "",
        },
      }),
    ).toEqual({
      "openai-compatible": {
        baseUrl: "http://localhost:8080/v1",
        documentPrompt: " document ",
        queryPrompt: "CodeRetrieval",
      },
    })
  })

  test("still removes prompt overrides when explicitly unset", () => {
    const before = {
      "openai-compatible": { baseUrl: "http://localhost:8080/v1", documentPrompt: "", queryPrompt: "" },
    }
    const after = clean(merge(before, { "openai-compatible": { documentPrompt: undefined, queryPrompt: undefined } }))

    expect(after).toEqual({ "openai-compatible": { baseUrl: "http://localhost:8080/v1" } })
    expect(removed(before, after)).toEqual([
      ["indexing", "openai-compatible", "documentPrompt"],
      ["indexing", "openai-compatible", "queryPrompt"],
    ])
  })

  test("builds provider patches for custom selector changes", () => {
    expect(providerPatch("kilo", "default-embedding")).toEqual({
      provider: "kilo",
      model: "default-embedding",
      dimension: undefined,
    })
    expect(providerPatch("ollama", "ignored")).toEqual({
      provider: "ollama",
      model: undefined,
      dimension: undefined,
    })
    expect(providerPatch("")).toEqual({ provider: undefined, model: undefined, dimension: undefined })
  })

  test("validates numeric settings", () => {
    expect(validate({ dimension: 0, searchMinScore: 2, searchMaxResults: 0, embeddingBatchSize: 1.5 })).toEqual([
      "Vector dimension must be a positive integer.",
      "Search minimum score must be between 0 and 1.",
      "Search maximum results must be a positive integer.",
      "Embedding batch size must be a positive integer.",
    ])
  })

  test("parses and cleans file extension allowlists", () => {
    expect(parseFileExtensions(" PHP, , .JS, js, C++, c++ ")).toEqual([".c++", ".js", ".php"])
    expect(parseFileExtensions(" , , ")).toBeUndefined()
    expect(clean({ fileExtensions: [] })).toEqual({})
    expect(validate({ fileExtensions: ["*.js", ".d.ts", "src/php"] })).toEqual([
      "File extensions must contain only a name with an optional leading dot.",
    ])
  })
})
