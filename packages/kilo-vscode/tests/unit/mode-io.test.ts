import { describe, it, expect } from "bun:test"
import { parseImport, buildExport, MAX_IMPORT_SIZE } from "../../webview-ui/src/components/settings/mode-io"

describe("parseImport", () => {
  it("parses a valid full definition", () => {
    const json = JSON.stringify({
      name: "reviewer",
      description: "Reviews code",
      prompt: "You review code.",
      model: "anthropic/claude-sonnet-4-20250514",
      mode: "primary",
      temperature: 0.7,
      top_p: 0.9,
      steps: 10,
    })
    const result = parseImport(json, [])
    expect(result).toEqual({
      ok: true,
      name: "reviewer",
      config: {
        description: "Reviews code",
        prompt: "You review code.",
        model: "anthropic/claude-sonnet-4-20250514",
        mode: "primary",
        temperature: 0.7,
        top_p: 0.9,
        steps: 10,
      },
    })
  })

  it("defaults mode to primary when omitted", () => {
    const json = JSON.stringify({ name: "my-agent" })
    const result = parseImport(json, [])
    expect(result).toEqual({
      ok: true,
      name: "my-agent",
      config: { mode: "primary" },
    })
  })

  it("rejects invalid JSON", () => {
    expect(parseImport("not json", [])).toEqual({ ok: false, error: "invalidJson" })
  })

  it("rejects JSON null", () => {
    expect(parseImport("null", [])).toEqual({ ok: false, error: "invalidJson" })
  })

  it("rejects JSON array", () => {
    expect(parseImport("[]", [])).toEqual({ ok: false, error: "invalidJson" })
  })

  it("rejects JSON string", () => {
    expect(parseImport('"hello"', [])).toEqual({ ok: false, error: "invalidJson" })
  })

  it("rejects JSON number", () => {
    expect(parseImport("42", [])).toEqual({ ok: false, error: "invalidJson" })
  })

  it("rejects missing name", () => {
    expect(parseImport("{}", [])).toEqual({ ok: false, error: "invalidName" })
  })

  it("rejects name starting with number", () => {
    expect(parseImport(JSON.stringify({ name: "1agent" }), [])).toEqual({ ok: false, error: "invalidName" })
  })

  it("rejects name with uppercase", () => {
    expect(parseImport(JSON.stringify({ name: "MyAgent" }), [])).toEqual({ ok: false, error: "invalidName" })
  })

  it("rejects name with spaces", () => {
    expect(parseImport(JSON.stringify({ name: "my agent" }), [])).toEqual({ ok: false, error: "invalidName" })
  })

  it("rejects duplicate name", () => {
    const json = JSON.stringify({ name: "existing" })
    expect(parseImport(json, ["existing", "other"])).toEqual({ ok: false, error: "nameTaken" })
  })

  it("ignores invalid mode values", () => {
    const json = JSON.stringify({ name: "test", mode: "bogus" })
    const result = parseImport(json, [])
    expect(result).toEqual({
      ok: true,
      name: "test",
      config: { mode: "primary" },
    })
  })

  it("accepts all valid mode values", () => {
    for (const mode of ["subagent", "primary", "all"] as const) {
      const json = JSON.stringify({ name: "test", mode })
      const result = parseImport(json, [])
      expect(result).toEqual({ ok: true, name: "test", config: { mode } })
    }
  })

  it("ignores non-string and non-number fields", () => {
    const json = JSON.stringify({
      name: "test",
      description: 123,
      prompt: true,
      model: [],
      temperature: "hot",
      top_p: null,
      steps: "many",
    })
    const result = parseImport(json, [])
    expect(result).toEqual({ ok: true, name: "test", config: { mode: "primary" } })
  })

  it("trims whitespace from name", () => {
    const json = JSON.stringify({ name: "  trimmed  " })
    // "trimmed" doesn't have hyphens or digits so it should be valid
    const result = parseImport(json, [])
    expect(result).toEqual({ ok: true, name: "trimmed", config: { mode: "primary" } })
  })

  it("preserves valid permission entries", () => {
    const json = JSON.stringify({
      name: "reviewer",
      permission: { read: "allow", bash: "allow", edit: "deny", mcp: "ask" },
    })
    const result = parseImport(json, [])
    expect(result).toEqual({
      ok: true,
      name: "reviewer",
      config: {
        mode: "primary",
        permission: { read: "allow", bash: "allow", edit: "deny", mcp: "ask" },
      },
    })
  })

  it("drops invalid permission values", () => {
    const json = JSON.stringify({
      name: "test",
      permission: { read: "allow", bad: "nope", num: 42, arr: [] },
    })
    const result = parseImport(json, [])
    expect(result).toEqual({
      ok: true,
      name: "test",
      config: { mode: "primary", permission: { read: "allow" } },
    })
  })

  it("preserves nested per-pattern permission rules", () => {
    const json = JSON.stringify({
      name: "test",
      permission: { bash: { "*": "ask", uname: "allow" }, read: "allow" },
    })
    const result = parseImport(json, [])
    expect(result).toEqual({
      ok: true,
      name: "test",
      config: {
        mode: "primary",
        permission: { bash: { "*": "ask", uname: "allow" }, read: "allow" },
      },
    })
  })

  it("ignores non-object permission field", () => {
    const json = JSON.stringify({ name: "test", permission: "allow" })
    const result = parseImport(json, [])
    expect(result).toEqual({ ok: true, name: "test", config: { mode: "primary" } })
  })

  it("round-trips permission through export and import", () => {
    const cfg = {
      mode: "primary" as const,
      prompt: "Review code",
      permission: { read: "allow" as const, edit: "deny" as const },
    }
    const exported = buildExport("reviewer", cfg)
    const json = JSON.stringify(exported)
    const result = parseImport(json, [])
    expect(result).toEqual({
      ok: true,
      name: "reviewer",
      config: { mode: "primary", prompt: "Review code", permission: { read: "allow", edit: "deny" } },
    })
  })
})

describe("buildExport", () => {
  it("includes name and all config fields", () => {
    const result = buildExport("reviewer", {
      description: "Reviews code",
      prompt: "You review code.",
      model: "anthropic/claude-sonnet-4-20250514",
      mode: "primary",
      temperature: 0.7,
      top_p: 0.9,
      steps: 10,
    })
    expect(result).toEqual({
      name: "reviewer",
      description: "Reviews code",
      prompt: "You review code.",
      model: "anthropic/claude-sonnet-4-20250514",
      mode: "primary",
      temperature: 0.7,
      top_p: 0.9,
      steps: 10,
    })
  })

  it("handles empty config", () => {
    expect(buildExport("minimal", {})).toEqual({ name: "minimal" })
  })
})

describe("MAX_IMPORT_SIZE", () => {
  it("is 1 MB", () => {
    expect(MAX_IMPORT_SIZE).toBe(1_048_576)
  })
})
