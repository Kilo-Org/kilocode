import { describe, it, expect } from "bun:test"
import { buildConnectSrc, buildCspString } from "../../src/webview-html-utils"

describe("buildConnectSrc", () => {
  it("uses wildcard ports when no port specified", () => {
    const result = buildConnectSrc()
    expect(result).toContain("http://127.0.0.1:*")
    expect(result).toContain("http://localhost:*")
    expect(result).toContain("ws://127.0.0.1:*")
    expect(result).toContain("ws://localhost:*")
  })

  it("restricts to specific port when port provided", () => {
    const result = buildConnectSrc(3000)
    expect(result).toContain("http://127.0.0.1:3000")
    expect(result).toContain("http://localhost:3000")
    expect(result).toContain("ws://127.0.0.1:3000")
    expect(result).toContain("ws://localhost:3000")
  })

  it("does not include wildcard when port is provided", () => {
    const result = buildConnectSrc(3000)
    expect(result).not.toContain(":*")
  })

  it("uses the exact port number", () => {
    expect(buildConnectSrc(54321)).toContain(":54321")
  })
})

describe("buildCspString", () => {
  const cspSource = "vscode-resource://test"
  const nonce = "abc123"

  it("includes default-src 'none'", () => {
    expect(buildCspString(cspSource, nonce)).toContain("default-src 'none'")
  })

  it("includes nonce in script-src", () => {
    const result = buildCspString(cspSource, nonce)
    expect(result).toContain(`'nonce-${nonce}'`)
    expect(result).toContain("'wasm-unsafe-eval'")
  })

  it("includes cspSource in style-src and font-src", () => {
    const result = buildCspString(cspSource, nonce)
    expect(result).toContain(`style-src 'unsafe-inline' ${cspSource}`)
    expect(result).toContain(`font-src ${cspSource}`)
  })

  it("includes cspSource and https: in img-src", () => {
    const result = buildCspString(cspSource, nonce)
    expect(result).toContain("img-src")
    expect(result).toContain(cspSource)
    expect(result).toContain("https:")
    expect(result).toContain("data:")
  })

  it("uses wildcard connect-src when no port provided", () => {
    const result = buildCspString(cspSource, nonce)
    expect(result).toContain("http://127.0.0.1:*")
  })

  it("uses specific port in connect-src when port provided", () => {
    const result = buildCspString(cspSource, nonce, 9000)
    expect(result).toContain("http://127.0.0.1:9000")
    expect(result).not.toContain(":*")
  })

  it("joins directives with semicolons", () => {
    const result = buildCspString(cspSource, nonce)
    const parts = result.split(";")
    expect(parts.length).toBeGreaterThanOrEqual(5)
  })
})
