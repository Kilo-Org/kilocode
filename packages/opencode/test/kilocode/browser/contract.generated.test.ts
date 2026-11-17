import { describe, expect, test } from "bun:test"
import { SHA256, UPSTREAM } from "../../../src/kilocode/browser/contract.generated"

// The extension vendors the same pin; its header records this SHA-256.
const EXTENSION_SHA256 = "6ee94e2fca227ae0a6304c476e20731acf4650f1f5856c9cf7b734a368fcadda"

describe("generated browser contract", () => {
  test("pins the shared Playwright MCP version", () => {
    expect(UPSTREAM).toBe("@playwright/mcp@0.0.81")
  })

  test("matches the extension's contract SHA-256", () => {
    expect(SHA256).toBe(EXTENSION_SHA256)
  })
})
