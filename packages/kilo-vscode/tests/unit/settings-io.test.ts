import { describe, it, expect } from "bun:test"
import {
  buildExport,
  parseImport,
  mergeConfig,
  MAX_IMPORT_SIZE,
  KNOWN_KEYS,
  META_VERSION,
} from "../../webview-ui/src/components/settings/settings-io"
import type { Config } from "../../webview-ui/src/types/messages"

// ---------------------------------------------------------------------------
// buildExport
// ---------------------------------------------------------------------------
describe("buildExport", () => {
  it("wraps config in _meta envelope", () => {
    const cfg: Config = { model: "anthropic/claude-sonnet-4-20250514" }
    const result = buildExport(cfg)
    expect(result._meta).toBeDefined()
    expect(result._meta.version).toBe(META_VERSION)
    expect(typeof result._meta.exportedAt).toBe("string")
    expect(result.model).toBe("anthropic/claude-sonnet-4-20250514")
  })

  it("preserves provider fields including secrets", () => {
    const cfg: Config = {
      provider: {
        openai: { name: "OpenAI", api_key: "sk-secret-123" },
        custom: { name: "Custom", options: { apiKey: "secret", baseURL: "https://example.com" } },
      },
    }
    const result = buildExport(cfg)
    expect(result.provider.openai.api_key).toBe("sk-secret-123")
    expect(result.provider.openai.name).toBe("OpenAI")
    expect(result.provider.custom.options.apiKey).toBe("secret")
    expect(result.provider.custom.options.baseURL).toBe("https://example.com")
  })

  it("preserves mcp fields including env and headers", () => {
    const cfg: Config = {
      mcp: {
        github: {
          type: "local" as const,
          command: "npx",
          env: { GITHUB_TOKEN: "ghp_secret123" },
          enabled: true,
        },
        server: {
          type: "local" as const,
          command: "node",
          environment: { SECRET: "val" },
        },
        remote: {
          type: "remote" as const,
          url: "https://mcp.example.com",
          headers: { Authorization: "Bearer secret-token" },
          enabled: true,
        },
      },
    }
    const result = buildExport(cfg)
    expect(result.mcp.github.env.GITHUB_TOKEN).toBe("ghp_secret123")
    expect(result.mcp.github.command).toBe("npx")
    expect(result.mcp.server.environment.SECRET).toBe("val")
    expect(result.mcp.remote.headers.Authorization).toBe("Bearer secret-token")
    expect(result.mcp.remote.url).toBe("https://mcp.example.com")
  })

  it("preserves all config fields", () => {
    const cfg: Config = {
      model: "test-model",
      small_model: "test-small",
      default_agent: "coder",
      agent: { coder: { mode: "primary", prompt: "Code stuff" } },
      permission: { read: "allow" },
      instructions: ["rule1.md"],
      snapshot: true,
      share: "manual",
    }
    const result = buildExport(cfg)
    expect(result.model).toBe("test-model")
    expect(result.small_model).toBe("test-small")
    expect(result.default_agent).toBe("coder")
    expect(result.agent).toEqual({ coder: { mode: "primary", prompt: "Code stuff" } })
    expect(result.permission).toEqual({ read: "allow" })
    expect(result.instructions).toEqual(["rule1.md"])
    expect(result.snapshot).toBe(true)
    expect(result.share).toBe("manual")
  })

  it("handles empty config", () => {
    const result = buildExport({})
    expect(result._meta).toBeDefined()
    expect(Object.keys(result).length).toBe(1) // only _meta
  })

  it("handles config with no providers or mcp", () => {
    const cfg: Config = { model: "test" }
    const result = buildExport(cfg)
    expect(result.model).toBe("test")
    expect(result.provider).toBeUndefined()
    expect(result.mcp).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// parseImport
// ---------------------------------------------------------------------------
describe("parseImport", () => {
  it("rejects non-JSON", () => {
    const result = parseImport("not json at all")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe("invalidJson")
  })

  it("rejects JSON null", () => {
    const result = parseImport("null")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe("invalidJson")
  })

  it("rejects JSON array", () => {
    const result = parseImport("[]")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe("invalidJson")
  })

  it("rejects JSON string", () => {
    const result = parseImport('"hello"')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe("invalidJson")
  })

  it("rejects JSON number", () => {
    const result = parseImport("42")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe("invalidJson")
  })

  it("rejects empty object (no known keys)", () => {
    const result = parseImport("{}")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe("invalidConfig")
  })

  it("rejects object with only unknown keys", () => {
    const result = parseImport(JSON.stringify({ foo: "bar", baz: 42 }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe("invalidConfig")
  })

  it("accepts valid partial config (just agent)", () => {
    const json = JSON.stringify({
      agent: { coder: { mode: "primary", prompt: "Code things" } },
    })
    const result = parseImport(json)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.agent).toEqual({ coder: { mode: "primary", prompt: "Code things" } })
    }
  })

  it("accepts valid partial config (just model)", () => {
    const json = JSON.stringify({ model: "test-model" })
    const result = parseImport(json)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.config.model).toBe("test-model")
  })

  it("strips _meta before returning config", () => {
    const json = JSON.stringify({
      _meta: { version: 1, exportedAt: "2026-01-01", secretsStripped: true },
      model: "test",
    })
    const result = parseImport(json)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect((result.config as Record<string, unknown>)._meta).toBeUndefined()
      expect(result.config.model).toBe("test")
    }
  })

  it("strips unknown top-level keys", () => {
    const json = JSON.stringify({
      model: "test",
      unknownField: "should be stripped",
      anotherUnknown: 42,
    })
    const result = parseImport(json)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.model).toBe("test")
      expect((result.config as Record<string, unknown>).unknownField).toBeUndefined()
      expect((result.config as Record<string, unknown>).anotherUnknown).toBeUndefined()
    }
  })

  it("returns warning when _meta.version > current", () => {
    const json = JSON.stringify({
      _meta: { version: 999 },
      model: "test",
    })
    const result = parseImport(json)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.warning).toBe("newerVersion")
    }
  })

  it("returns no warning when _meta.version <= current", () => {
    const json = JSON.stringify({
      _meta: { version: META_VERSION },
      model: "test",
    })
    const result = parseImport(json)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.warning).toBeUndefined()
    }
  })

  it("returns no warning when _meta is absent", () => {
    const json = JSON.stringify({ model: "test" })
    const result = parseImport(json)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.warning).toBeUndefined()
    }
  })

  it("accepts config with all known keys", () => {
    const cfg: Record<string, unknown> = {}
    for (const key of KNOWN_KEYS) {
      cfg[key] = key === "instructions" ? ["rule.md"] : key === "snapshot" ? true : "value"
    }
    const json = JSON.stringify(cfg)
    const result = parseImport(json)
    expect(result.ok).toBe(true)
  })

  it("preserves provider and mcp fields as-is (including secrets on import)", () => {
    const json = JSON.stringify({
      provider: { openai: { name: "OpenAI", api_key: "sk-123" } },
      mcp: { gh: { command: "npx", env: { TOKEN: "secret" } } },
    })
    const result = parseImport(json)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.provider?.openai?.api_key).toBe("sk-123")
      expect(result.config.mcp?.gh?.env?.TOKEN).toBe("secret")
    }
  })
})

// ---------------------------------------------------------------------------
// mergeConfig
// ---------------------------------------------------------------------------
describe("mergeConfig", () => {
  it("merges imported agents with existing agents", () => {
    const existing: Config = {
      agent: {
        coder: { mode: "primary", prompt: "Code" },
        reviewer: { mode: "primary", prompt: "Review" },
      },
    }
    const imported: Config = {
      agent: {
        reviewer: { mode: "primary", prompt: "Updated review" },
        planner: { mode: "primary", prompt: "Plan" },
      },
    }
    const result = mergeConfig(existing, imported)
    expect(result.agent?.coder?.prompt).toBe("Code")
    expect(result.agent?.reviewer?.prompt).toBe("Updated review")
    expect(result.agent?.planner?.prompt).toBe("Plan")
  })

  it("imported values override existing for same keys", () => {
    const existing: Config = { model: "old-model", default_agent: "coder" }
    const imported: Config = { model: "new-model" }
    const result = mergeConfig(existing, imported)
    expect(result.model).toBe("new-model")
    expect(result.default_agent).toBe("coder")
  })

  it("existing values not in import are preserved", () => {
    const existing: Config = {
      model: "test",
      permission: { read: "allow" },
      instructions: ["old.md"],
    }
    const imported: Config = { model: "updated" }
    const result = mergeConfig(existing, imported)
    expect(result.model).toBe("updated")
    expect(result.permission).toEqual({ read: "allow" })
    expect(result.instructions).toEqual(["old.md"])
  })

  it("merges providers without losing existing ones", () => {
    const existing: Config = {
      provider: {
        openai: { name: "OpenAI", api_key: "sk-existing" },
        anthropic: { name: "Anthropic", api_key: "sk-ant" },
      },
    }
    const imported: Config = {
      provider: {
        openai: { name: "OpenAI Updated", base_url: "https://new.api" },
      },
    }
    const result = mergeConfig(existing, imported)
    expect(result.provider?.openai?.name).toBe("OpenAI Updated")
    expect(result.provider?.openai?.base_url).toBe("https://new.api")
    expect(result.provider?.anthropic?.name).toBe("Anthropic")
    expect(result.provider?.anthropic?.api_key).toBe("sk-ant")
  })

  it("handles empty existing config", () => {
    const imported: Config = { model: "test", agent: { coder: { mode: "primary" } } }
    const result = mergeConfig({}, imported)
    expect(result.model).toBe("test")
    expect(result.agent?.coder?.mode).toBe("primary")
  })

  it("handles empty imported config", () => {
    const existing: Config = { model: "test" }
    const result = mergeConfig(existing, {})
    expect(result.model).toBe("test")
  })
})

// ---------------------------------------------------------------------------
// Round-trip
// ---------------------------------------------------------------------------
describe("round-trip", () => {
  it("export then import preserves all fields including secrets", () => {
    const original: Config = {
      model: "test-model",
      agent: { coder: { mode: "primary", prompt: "Code" } },
      provider: { openai: { name: "OpenAI", api_key: "sk-secret" } },
      mcp: { gh: { command: "npx", env: { TOKEN: "secret" } } },
      permission: { read: "allow" },
      instructions: ["rules.md"],
    }
    const exported = buildExport(original)
    const json = JSON.stringify(exported)
    const result = parseImport(json)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.model).toBe("test-model")
      expect(result.config.agent).toEqual({ coder: { mode: "primary", prompt: "Code" } })
      expect(result.config.provider?.openai?.name).toBe("OpenAI")
      expect(result.config.provider?.openai?.api_key).toBe("sk-secret")
      expect(result.config.mcp?.gh?.command).toBe("npx")
      expect(result.config.mcp?.gh?.env?.TOKEN).toBe("secret")
      expect(result.config.permission).toEqual({ read: "allow" })
      expect(result.config.instructions).toEqual(["rules.md"])
    }
  })
})

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
describe("constants", () => {
  it("MAX_IMPORT_SIZE is 1 MB", () => {
    expect(MAX_IMPORT_SIZE).toBe(1_048_576)
  })

  it("META_VERSION is 1", () => {
    expect(META_VERSION).toBe(1)
  })

  it("KNOWN_KEYS includes core config keys", () => {
    expect(KNOWN_KEYS).toContain("agent")
    expect(KNOWN_KEYS).toContain("provider")
    expect(KNOWN_KEYS).toContain("mcp")
    expect(KNOWN_KEYS).toContain("permission")
    expect(KNOWN_KEYS).toContain("model")
    expect(KNOWN_KEYS).toContain("instructions")
  })

  it("KNOWN_KEYS matches all keys in the Config interface (drift guard)", async () => {
    // Read the Config interface from messages.ts and extract its keys.
    // If someone adds a new field to Config, this test fails as a reminder
    // to also add it to KNOWN_KEYS in settings-io.ts.
    const src = await Bun.file(require("path").join(__dirname, "../../webview-ui/src/types/messages.ts")).text()
    const match = src.match(/export interface Config \{([^}]+)\}/)
    expect(match).not.toBeNull()
    const body = match![1]
    const keys = [...body.matchAll(/^\s+(\w+)\??:/gm)].map((m) => m[1])
    expect(keys.length).toBeGreaterThan(0)

    const sorted = (arr: readonly string[]) => [...arr].sort()
    expect(sorted(KNOWN_KEYS)).toEqual(sorted(keys))
  })
})
