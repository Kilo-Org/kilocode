import { describe, it, expect } from "bun:test"
import { parseServerPort } from "../../src/services/cli-backend/server-utils"

describe("parseServerPort", () => {
  it("parses port from standard CLI startup message", () => {
    expect(parseServerPort("kilo server listening on http://127.0.0.1:12345")).toBe(12345)
  })

  it("parses port from localhost variant", () => {
    expect(parseServerPort("listening on http://localhost:8080")).toBe(8080)
  })

  it("parses port when embedded in longer output", () => {
    const output = "[INFO] 2024-01-01 kilo server listening on http://127.0.0.1:54321\n[INFO] ready"
    expect(parseServerPort(output)).toBe(54321)
  })

  it("returns null for output without listening message", () => {
    expect(parseServerPort("Starting server...")).toBeNull()
  })

  it("returns null for empty string", () => {
    expect(parseServerPort("")).toBeNull()
  })

  it("returns null when no port in URL", () => {
    expect(parseServerPort("listening on http://127.0.0.1")).toBeNull()
  })

  it("parses high port numbers", () => {
    expect(parseServerPort("listening on http://127.0.0.1:65535")).toBe(65535)
  })

  it("parses port 1 (edge case)", () => {
    expect(parseServerPort("listening on http://127.0.0.1:1")).toBe(1)
  })

  it("returns null for stderr-style messages without port", () => {
    expect(parseServerPort("[ERROR] failed to bind port")).toBeNull()
  })

  it("matches only first occurrence when multiple ports present", () => {
    const output = "listening on http://127.0.0.1:3000 and http://127.0.0.1:4000"
    expect(parseServerPort(output)).toBe(3000)
  })
})
