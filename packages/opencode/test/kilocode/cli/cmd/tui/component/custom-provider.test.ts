// kilocode_change - new file
//
// Unit tests for the pure logic powering the TUI custom OpenAI-compatible
// provider wizard. Port coverage of extension helpers (`validateProviderID`,
// `parseCustomProviderSecret`, `withCustomProviderDeletions`, `fetchOpenAIModels`)
// so the TUI produces equivalent config shapes.

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import {
  buildPatchWithDeletions,
  buildSanitized,
  CUSTOM_PROVIDER_NPM,
  fetchModels,
  isCustomProvider,
  normalizeProviderID,
  parseSecret,
  PROVIDER_ID_PATTERN,
  validateBaseURL,
  validateProviderID,
} from "../../../../../../src/kilocode/cli/cmd/tui/component/custom-provider"

describe("normalizeProviderID", () => {
  it("trims and strips the @ai-sdk/ prefix", () => {
    expect(normalizeProviderID("  custom-provider  ")).toBe("custom-provider")
    expect(normalizeProviderID("@ai-sdk/custom-provider")).toBe("custom-provider")
  })

  it("rejects invalid characters and leading hyphens", () => {
    expect(normalizeProviderID("Custom Provider")).toBeUndefined()
    expect(normalizeProviderID("-leading-hyphen")).toBeUndefined()
    expect(normalizeProviderID("with space")).toBeUndefined()
  })

  it("accepts lowercase letters, digits, hyphens, and underscores", () => {
    expect(normalizeProviderID("my-provider_2")).toBe("my-provider_2")
    expect(normalizeProviderID("a")).toBe("a")
    expect(normalizeProviderID("0-leading-digit")).toBe("0-leading-digit")
  })
})

describe("validateProviderID", () => {
  it("delegates to normalizeProviderID", () => {
    expect(validateProviderID("good-id")).toBe("good-id")
    expect(validateProviderID("Bad ID")).toBeUndefined()
  })
})

describe("PROVIDER_ID_PATTERN", () => {
  it("matches the extension's id rule", () => {
    expect(PROVIDER_ID_PATTERN.test("good-id_2")).toBe(true)
    expect(PROVIDER_ID_PATTERN.test("Bad")).toBe(false)
    expect(PROVIDER_ID_PATTERN.test("-bad")).toBe(false)
  })
})

describe("validateBaseURL", () => {
  it("requires http or https scheme", () => {
    expect(validateBaseURL("ftp://nope")).toBe("Base URL must start with http:// or https://")
    expect(validateBaseURL("api.example.com/v1")).toBe("Base URL must start with http:// or https://")
  })

  it("returns undefined for valid URLs", () => {
    expect(validateBaseURL("http://localhost:11434/v1")).toBeUndefined()
    expect(validateBaseURL("https://api.example.com/v1/")).toBeUndefined()
    expect(validateBaseURL("  http://x  ")).toBeUndefined()
  })

  it("rejects empty input", () => {
    expect(validateBaseURL("")).toBe("Base URL is required")
    expect(validateBaseURL("   ")).toBe("Base URL is required")
  })
})

describe("parseSecret", () => {
  it("returns preserve for empty input", () => {
    expect(parseSecret("")).toEqual({ kind: "preserve" })
    expect(parseSecret("   ")).toEqual({ kind: "preserve" })
  })

  it("returns key for arbitrary text", () => {
    expect(parseSecret("sk-abc")).toEqual({ kind: "key", key: "sk-abc" })
    expect(parseSecret("  trimmed  ")).toEqual({ kind: "key", key: "trimmed" })
  })

  it("returns env for {env:VAR_NAME} syntax", () => {
    expect(parseSecret("{env:MY_KEY}")).toEqual({ kind: "env", name: "MY_KEY" })
    expect(parseSecret("{env: SINGLE }")).toEqual({ kind: "env", name: "SINGLE" })
  })

  it("rejects invalid env var names", () => {
    expect(parseSecret("{env:1BAD}")).toMatchObject({ error: expect.any(String) })
    expect(parseSecret("{env:lower}")).toMatchObject({ error: expect.any(String) })
  })
})

describe("isCustomProvider", () => {
  it("returns true when npm is a string", () => {
    expect(isCustomProvider({ npm: CUSTOM_PROVIDER_NPM })).toBe(true)
  })

  it("returns false for built-in providers or invalid input", () => {
    expect(isCustomProvider({ name: "x" })).toBe(false)
    expect(isCustomProvider(null)).toBe(false)
    expect(isCustomProvider("not-an-object")).toBe(false)
  })
})

describe("buildSanitized", () => {
  it("produces the canonical config shape", () => {
    const result = buildSanitized({
      id: "vllm",
      name: "vLLM",
      baseURL: "http://localhost:8000/v1",
      secret: { kind: "key", key: "sk-abc" },
      models: [{ id: "qwen", name: "Qwen" }],
    })
    expect(result).toEqual({
      npm: "@ai-sdk/openai-compatible",
      name: "vLLM",
      options: { baseURL: "http://localhost:8000/v1" },
      models: { qwen: { name: "Qwen" } },
    })
  })

  it("writes env array instead of apiKey when secret is env", () => {
    const result = buildSanitized({
      id: "p",
      name: "P",
      baseURL: "https://api.example.com/v1",
      secret: { kind: "env", name: "MY_VAR" },
      models: [{ id: "m", name: "M" }],
    })
    expect(result).toMatchObject({ env: ["MY_VAR"] })
  })

  it("rejects missing models", () => {
    const result = buildSanitized({
      id: "p",
      name: "P",
      baseURL: "https://api.example.com/v1",
      secret: { kind: "key", key: "k" },
      models: [],
    })
    expect(result).toMatchObject({ error: "At least one model is required" })
  })

  it("rejects duplicate model ids", () => {
    const result = buildSanitized({
      id: "p",
      name: "P",
      baseURL: "https://api.example.com/v1",
      secret: { kind: "key", key: "k" },
      models: [
        { id: "dup", name: "A" },
        { id: "dup", name: "B" },
      ],
    })
    expect(result).toMatchObject({ error: "Duplicate model ID: dup" })
  })

  it("rejects invalid baseURL", () => {
    const result = buildSanitized({
      id: "p",
      name: "P",
      baseURL: "ftp://nope",
      secret: { kind: "key", key: "k" },
      models: [{ id: "m", name: "M" }],
    })
    expect(result).toMatchObject({ error: expect.stringContaining("Base URL") })
  })
})

describe("buildPatchWithDeletions", () => {
  it("emits null sentinels for removed models", () => {
    const existing = {
      models: {
        keep: { name: "Keep" },
        gone: { name: "Gone" },
      },
    }
    const next = {
      npm: "@ai-sdk/openai-compatible",
      name: "P",
      options: { baseURL: "http://x" },
      models: { keep: { name: "Keep" } },
    }
    const patched = buildPatchWithDeletions(existing, next)
    expect(patched.models["keep"]).toEqual({ name: "Keep" })
    expect(patched.models["gone"]).toBeNull()
  })

  it("leaves the new shape intact when there is no existing config", () => {
    const next = {
      npm: "@ai-sdk/openai-compatible",
      name: "P",
      options: { baseURL: "http://x" },
      models: { a: { name: "A" } },
    }
    const patched = buildPatchWithDeletions(undefined, next)
    expect(patched.models).toEqual({ a: { name: "A" } })
  })

  it("preserves non-model fields on the patch", () => {
    const existing = { models: { gone: { name: "G" } } }
    const next = {
      npm: "@ai-sdk/openai-compatible",
      name: "P",
      options: { baseURL: "http://x" },
      env: ["MY_VAR"],
      models: {},
    }
    const patched = buildPatchWithDeletions(existing, next)
    expect(patched.models["gone"]).toBeNull()
    expect(patched.env).toEqual(["MY_VAR"])
  })
})

describe("fetchModels", () => {
  let server: ReturnType<typeof Bun.serve>
  let baseURL = ""
  let lastAuth: string | null = null

  beforeEach(() => {
    lastAuth = null
  })

  afterEach(() => {
    server?.stop(true)
  })

  it("maps the OpenAI /v1/models response and sends Authorization when given a key", async () => {
    server = Bun.serve({
      port: 0,
      fetch(req) {
        lastAuth = req.headers.get("authorization")
        return new Response(
          JSON.stringify({
            data: [
              { id: "b-model", name: "B Model" },
              { id: "a-model", name: "A Model" },
              { id: "dup", name: "Dup 1" },
              { id: "dup", name: "Dup 2" },
              { id: "", name: "Empty" },
              { name: "NoId" },
            ],
          }),
          { headers: { "Content-Type": "application/json" } },
        )
      },
    })
    baseURL = `http://localhost:${server.port}/v1`
    const result = await fetchModels(baseURL, "sk-abc")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(lastAuth).toBe("Bearer sk-abc")
    expect(result.models.map((m) => m.id)).toEqual(["a-model", "b-model", "dup"])
    expect(result.models.find((m) => m.id === "dup")?.name).toBe("Dup 1")
  })

  it("does not send Authorization when no key is provided", async () => {
    server = Bun.serve({
      port: 0,
      fetch(req) {
        lastAuth = req.headers.get("authorization")
        return new Response(JSON.stringify({ data: [] }), { headers: { "Content-Type": "application/json" } })
      },
    })
    baseURL = `http://localhost:${server.port}/v1`
    const result = await fetchModels(baseURL)
    expect(result.ok).toBe(true)
    expect(lastAuth).toBeNull()
  })

  it("returns an error on non-2xx responses", async () => {
    server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("nope", { status: 401 })
      },
    })
    baseURL = `http://localhost:${server.port}/v1`
    const result = await fetchModels(baseURL, "k")
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(401)
    expect(result.error).toContain("401")
  })

  it("returns an error when the server is unreachable", async () => {
    // Find a port that is guaranteed to refuse connections.
    const probe = Bun.serve({ port: 0, fetch: () => new Response("") })
    const port = probe.port
    probe.stop(true)
    const result = await fetchModels(`http://localhost:${port}/v1`)
    expect(result.ok).toBe(false)
  })

  it("handles missing data array", async () => {
    server = Bun.serve({
      port: 0,
      fetch: () => new Response(JSON.stringify({}), { headers: { "Content-Type": "application/json" } }),
    })
    baseURL = `http://localhost:${server.port}/v1`
    const result = await fetchModels(baseURL)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.models).toEqual([])
  })
})