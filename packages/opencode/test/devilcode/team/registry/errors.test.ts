import { describe, it, expect } from "bun:test"
import {
  TeamRegistryError,
  TeamSignatureError,
  TeamPublisherNotTrusted,
  TeamManifestFetchFailed,
  TeamManifestInvalid,
} from "@/devilcode/team/registry/errors"

describe("TeamRegistryError", () => {
  it("is an instance of Error", () => {
    const err = new TeamRegistryError("signature_error", "boom")
    expect(err instanceof Error).toBe(true)
  })

  it("has the correct name and kind", () => {
    const err = new TeamRegistryError("manifest_invalid", "bad manifest")
    expect(err.name).toBe("TeamRegistryError")
    expect(err.kind).toBe("manifest_invalid")
    expect(err.message).toBe("bad manifest")
  })
})

describe("TeamSignatureError", () => {
  it("has name=TeamSignatureError and kind=signature_error", () => {
    const err = new TeamSignatureError()
    expect(err.name).toBe("TeamSignatureError")
    expect(err.kind).toBe("signature_error")
    expect(err instanceof TeamRegistryError).toBe(true)
    expect(err instanceof Error).toBe(true)
  })

  it("uses default message when none provided", () => {
    const err = new TeamSignatureError()
    expect(err.message).toContain("signature")
  })

  it("accepts a custom message", () => {
    const err = new TeamSignatureError("custom sig error")
    expect(err.message).toBe("custom sig error")
  })
})

describe("TeamPublisherNotTrusted", () => {
  it("has name=TeamPublisherNotTrusted, kind=publisher_not_trusted, and publisherId", () => {
    const err = new TeamPublisherNotTrusted("pub-123")
    expect(err.name).toBe("TeamPublisherNotTrusted")
    expect(err.kind).toBe("publisher_not_trusted")
    expect(err.publisherId).toBe("pub-123")
    expect(err instanceof TeamRegistryError).toBe(true)
    expect(err instanceof Error).toBe(true)
  })

  it("default message includes publisherId", () => {
    const err = new TeamPublisherNotTrusted("pub-abc")
    expect(err.message).toContain("pub-abc")
  })

  it("accepts a custom message", () => {
    const err = new TeamPublisherNotTrusted("p1", "custom message")
    expect(err.message).toBe("custom message")
  })
})

describe("TeamManifestFetchFailed", () => {
  it("has name=TeamManifestFetchFailed, kind=manifest_fetch_failed, url and optional statusCode", () => {
    const err = new TeamManifestFetchFailed({ url: "https://example.com/index.json", statusCode: 404 })
    expect(err.name).toBe("TeamManifestFetchFailed")
    expect(err.kind).toBe("manifest_fetch_failed")
    expect(err.url).toBe("https://example.com/index.json")
    expect(err.statusCode).toBe(404)
    expect(err instanceof TeamRegistryError).toBe(true)
    expect(err instanceof Error).toBe(true)
  })

  it("works without statusCode", () => {
    const err = new TeamManifestFetchFailed({ url: "https://example.com/x.json" })
    expect(err.statusCode).toBeUndefined()
    expect(err.url).toBe("https://example.com/x.json")
  })

  it("default message includes url", () => {
    const err = new TeamManifestFetchFailed({ url: "https://example.com/x.json" })
    expect(err.message).toContain("https://example.com/x.json")
  })

  it("accepts a custom message", () => {
    const err = new TeamManifestFetchFailed({ url: "https://x.com", message: "timed out" })
    expect(err.message).toBe("timed out")
  })
})

describe("TeamManifestInvalid", () => {
  it("has name=TeamManifestInvalid, kind=manifest_invalid, issues and source", () => {
    const err = new TeamManifestInvalid({ issues: ["field x missing", "field y invalid"], source: "https://example.com" })
    expect(err.name).toBe("TeamManifestInvalid")
    expect(err.kind).toBe("manifest_invalid")
    expect(err.issues).toEqual(["field x missing", "field y invalid"])
    expect(err.source).toBe("https://example.com")
    expect(err instanceof TeamRegistryError).toBe(true)
    expect(err instanceof Error).toBe(true)
  })

  it("default message includes source", () => {
    const err = new TeamManifestInvalid({ issues: [], source: "https://example.com/m.json" })
    expect(err.message).toContain("https://example.com/m.json")
  })

  it("accepts a custom message", () => {
    const err = new TeamManifestInvalid({ issues: [], source: "x", message: "custom invalid" })
    expect(err.message).toBe("custom invalid")
  })
})
