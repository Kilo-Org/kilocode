import { describe, expect, it } from "bun:test"
import {
  indexingConfig,
  indexingDescription,
  indexingEnabled,
  indexingEnabledInherited,
  indexingFieldDisplay,
  indexingInheritance,
  indexingSource,
  indexingUpdate,
  type IndexingFieldInfo,
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

function managedField(value: unknown, editable = true): IndexingFieldInfo {
  return {
    key: "indexing.provider",
    path: ["indexing", "provider"],
    value,
    source: "system",
    inherited: false,
    overridden: false,
    editable,
    reason: "Resolved from runtime, cloud, environment, or managed config.",
  }
}

const managedFields: Record<string, IndexingFieldInfo> = {
  "indexing.provider": managedField("openai-compatible"),
  "indexing.model": managedField("granite-embedding-107m-multilingual"),
  "indexing.dimension": managedField(384),
  "indexing.openai-compatible.baseUrl": managedField("http://embed.test/v1/embeddings"),
  "indexing.fileExtensions": managedField([".cs", ".md"]),
}

describe("indexing managed-config display", () => {
  it("shows managed values when no raw scope defines them", () => {
    expect(indexingFieldDisplay("project", {}, {}, managedFields, ["provider"]).value).toBe("openai-compatible")
    expect(indexingFieldDisplay("project", {}, {}, managedFields, ["provider"]).source).toBe("managed")
    expect(indexingFieldDisplay("project", {}, {}, managedFields, ["model"]).value).toBe(
      "granite-embedding-107m-multilingual",
    )
    expect(indexingFieldDisplay("project", {}, {}, managedFields, ["dimension"]).value).toBe(384)
    expect(indexingFieldDisplay("project", {}, {}, managedFields, ["openai-compatible", "baseUrl"]).value).toBe(
      "http://embed.test/v1/embeddings",
    )
    expect(indexingFieldDisplay("project", {}, {}, managedFields, ["fileExtensions"]).value).toEqual([".cs", ".md"])
  })

  it("keeps raw scope values ahead of managed values", () => {
    const project = indexingFieldDisplay("project", {}, { provider: "ollama" }, managedFields, ["provider"])
    expect(project.value).toBe("ollama")
    expect(project.source).toBe("local")

    const global = indexingFieldDisplay("project", { provider: "gemini" }, {}, managedFields, ["provider"])
    expect(global.value).toBe("gemini")
    expect(global.source).toBe("global")
  })

  it("locks a managed value in the global view but keeps it overridable in the project view", () => {
    // The snapshot fetches the overlay at project scope, so a system-sourced field arrives with
    // editable:true. The global view must still lock it from its source.
    const fields = { "indexing.provider": managedField("openai-compatible", true) }

    const global = indexingFieldDisplay("global", {}, {}, fields, ["provider"])
    expect(global.value).toBe("openai-compatible")
    expect(global.source).toBe("managed")
    expect(global.editable).toBe(false)

    const project = indexingFieldDisplay("project", {}, {}, fields, ["provider"])
    expect(project.value).toBe("openai-compatible")
    expect(project.source).toBe("managed")
    expect(project.editable).toBe(true)
  })

  it("lets a raw value override a managed value at the matching scope", () => {
    const fields = { "indexing.provider": managedField("openai-compatible", true) }

    const project = indexingFieldDisplay("project", {}, { provider: "ollama" }, fields, ["provider"])
    expect(project.value).toBe("ollama")
    expect(project.source).toBe("local")
    expect(project.editable).toBe(true)
  })

  it("keeps an editable managed value losing to a coexisting raw value", () => {
    const fields = { "indexing.provider": managedField("openai-compatible", true) }
    const display = indexingFieldDisplay("project", {}, { provider: "ollama" }, fields, ["provider"])
    expect(display.value).toBe("ollama")
    expect(display.source).toBe("local")
    expect(display.editable).toBe(true)
  })

  it("reports managed values as not editable in global scope even when stored as editable", () => {
    // stored `editable` reflects the project-scoped fetch; the source is what drives the lock.
    const fields = { "indexing.provider": managedField("openai-compatible", true) }
    const display = indexingFieldDisplay("global", {}, {}, fields, ["provider"])
    expect(display.value).toBe("openai-compatible")
    expect(display.source).toBe("managed")
    expect(display.editable).toBe(false)
  })

  it("keeps a globally-defined field editable in the global view over a managed value", () => {
    const fields: Record<string, IndexingFieldInfo> = {
      "indexing.provider": {
        key: "indexing.provider",
        path: ["indexing", "provider"],
        value: "gemini",
        source: "global",
        inherited: false,
        overridden: false,
        editable: true,
      },
    }
    const display = indexingFieldDisplay("global", { provider: "gemini" }, {}, fields, ["provider"])
    expect(display.value).toBe("gemini")
    // At global scope the raw branch reports no inheritance tag; the value is the user's own.
    expect(display.source).toBe("none")
    expect(display.editable).toBe(true)
  })

  it("falls back to default when no layer defines the value", () => {
    expect(indexingFieldDisplay("project", {}, {}, undefined, ["provider"]).value).toBeUndefined()
    expect(indexingFieldDisplay("project", {}, {}, {}, ["provider"]).source).toBe("default")
    expect(indexingFieldDisplay("project", {}, {}, {}, ["provider"]).editable).toBe(true)
  })

  it("describes managed inheritance", () => {
    expect(indexingDescription("Configure this value.", "managed")).toBe(
      "Configure this value. Inherited from managed config.",
    )
  })
})
