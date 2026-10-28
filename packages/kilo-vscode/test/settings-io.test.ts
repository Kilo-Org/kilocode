import { describe, expect, it } from "bun:test"
import {
  buildExport,
  KNOWN_KEYS,
  MAX_IMPORT_SIZE,
  META_VERSION,
  parseImport,
} from "../webview-ui/src/components/settings/settings-io"

describe("buildExport", () => {
  it("wraps the config in a _meta envelope", () => {
    const result = buildExport({ model: "anthropic/claude-sonnet-4" })
    expect((result._meta as { version: number }).version).toBe(META_VERSION)
    expect(typeof (result._meta as { exportedAt: string }).exportedAt).toBe("string")
    expect(result.model).toBe("anthropic/claude-sonnet-4")
  })

  it("drops $schema and null keys", () => {
    const result = buildExport({ $schema: "https://example.com", username: undefined as unknown as string, share: null })
    expect(result.$schema).toBeUndefined()
    expect(result.username).toBeUndefined()
    expect(result.share).toBeUndefined()
  })
})

describe("parseImport", () => {
  it("keeps only known top-level keys and strips _meta", () => {
    const result = parseImport(JSON.stringify({ _meta: { version: 1 }, username: "ada", unknown_key: 1 }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config).toEqual({ username: "ada" })
    expect(result.config.unknown_key).toBeUndefined()
    expect(result.config._meta).toBeUndefined()
  })

  it("rejects invalid JSON", () => {
    expect(parseImport("not json")).toEqual({ ok: false, error: "invalidJson" })
  })

  it("rejects an object with no known keys", () => {
    expect(parseImport(JSON.stringify({ nope: true }))).toEqual({ ok: false, error: "invalidConfig" })
  })

  it("warns on a newer export version", () => {
    const result = parseImport(JSON.stringify({ _meta: { version: META_VERSION + 1 }, model: "kilo/x" }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warning).toBe("newerVersion")
  })

  it("exposes the v2 known keys and the 1 MB cap", () => {
    expect(KNOWN_KEYS).toContain("username")
    expect(KNOWN_KEYS).toContain("permissions")
    expect(KNOWN_KEYS).not.toContain("permission")
    expect(MAX_IMPORT_SIZE).toBe(1_048_576)
  })
})
