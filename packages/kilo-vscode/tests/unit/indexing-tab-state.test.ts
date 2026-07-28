import { describe, expect, it } from "bun:test"
import {
  indexingConfig,
  indexingDescription,
  indexingEnabled,
  indexingEnabledInherited,
  indexingInheritance,
  indexingSource,
  indexingUpdate,
} from "../../webview-ui/src/components/settings/indexing-tab-state"

describe("indexing tab scope state", () => {
  it("uses the global value when project enablement is inherited", () => {
    expect(indexingEnabled("project", { enabled: true }, {})).toBe(true)
    expect(indexingEnabled("project", { enabled: false }, {})).toBe(false)
    expect(indexingEnabledInherited("project", { enabled: true }, {})).toBe(true)
    expect(indexingEnabledInherited("project", { enabled: false }, {})).toBe(true)
  })

  it("uses explicit project overrides", () => {
    expect(indexingEnabled("project", { enabled: true }, { enabled: false })).toBe(false)
    expect(indexingEnabled("project", { enabled: false }, { enabled: true })).toBe(true)
    expect(indexingEnabledInherited("project", { enabled: true }, { enabled: false })).toBe(false)
  })

  it("ignores project values in global scope", () => {
    const global = { enabled: false, provider: "openai" as const, openai: { apiKey: "global" } }
    const project = { enabled: true, provider: "ollama" as const, ollama: { baseUrl: "http://project" } }

    expect(indexingEnabled("global", global, project)).toBe(false)
    expect(indexingEnabledInherited("global", global, {})).toBe(false)
    expect(indexingConfig("global", global, project)).toEqual(global)
  })

  it("keeps inherited values out of project updates", () => {
    expect(
      indexingUpdate(
        "project",
        { enabled: true, provider: "openai", openai: { apiKey: "global" } },
        { qdrant: { url: "http://project" } },
        { enabled: false },
      ),
    ).toEqual({ enabled: false, qdrant: { url: "http://project" } })
  })

  it("preserves explicit null overrides and recursively inherits undefined leaves", () => {
    expect(
      indexingConfig(
        "project",
        {
          model: "global-model",
          dimension: 1024,
          qdrant: { url: "http://global", apiKey: "global-secret" },
        },
        {
          model: null,
          dimension: null,
          qdrant: { url: "http://project", apiKey: undefined },
        },
      ),
    ).toEqual({
      model: null,
      dimension: null,
      qdrant: { url: "http://project", apiKey: "global-secret" },
    })
  })

  it("classifies inherited and partially inherited fields", () => {
    const global = {
      provider: "openai-compatible" as const,
      model: "global-model",
      dimension: 1024,
      "openai-compatible": { baseUrl: "https://global.test", apiKey: "secret" },
    }
    const project = {
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
    expect(indexingInheritance("project", {}, {}, [["vectorStore"]])).toBe("none")
    expect(indexingSource("project", global, project, [["provider"]])).toBe("global")
    expect(indexingSource("project", global, project, [["model"]])).toBe("local")
    expect(
      indexingSource("project", global, project, [
        ["openai-compatible", "baseUrl"],
        ["openai-compatible", "apiKey"],
      ]),
    ).toBe("mixed")
    expect(indexingSource("project", {}, {}, [["vectorStore"]])).toBe("default")
    expect(indexingSource("global", global, project, [["provider"]])).toBe("none")
    expect(indexingDescription("Configure this value.", "inherited")).toBe(
      "Configure this value. Inherited from global config.",
    )
  })

  it("merges inherited values with project overrides", () => {
    expect(
      indexingConfig(
        "project",
        {
          enabled: true,
          provider: "openai",
          model: "global-model",
          vectorStore: "qdrant",
          openai: { apiKey: "global" },
          qdrant: { url: "http://global", apiKey: "global-secret" },
        },
        { provider: "ollama", qdrant: { url: "http://project" } },
      ),
    ).toEqual({
      enabled: true,
      provider: "ollama",
      model: "global-model",
      vectorStore: "qdrant",
      openai: { apiKey: "global" },
      qdrant: { url: "http://project", apiKey: "global-secret" },
    })
  })

  it("replaces inherited file extensions with a project allowlist", () => {
    const global = { fileExtensions: [".ts", ".tsx"] }

    expect(indexingConfig("project", global, {}).fileExtensions).toEqual([".ts", ".tsx"])
    expect(indexingConfig("project", global, { fileExtensions: [".php"] }).fileExtensions).toEqual([".php"])
    expect(indexingInheritance("project", global, {}, [["fileExtensions"]])).toBe("inherited")
    expect(indexingInheritance("project", global, { fileExtensions: [".php"] }, [["fileExtensions"]])).toBe("none")
  })
})
