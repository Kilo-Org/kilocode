import { describe, it, expect } from "bun:test"
import { buildConnectSrc, buildCspString } from "../../src/webview-html-utils"
import { KiloProvider } from "../../src/KiloProvider"

describe("Settings webview entry", () => {
  function html(route?: () => { tab?: string; projectId?: string }) {
    const provider = new KiloProvider(
      { fsPath: "/extension" } as never,
      { getServerInfo: () => ({ port: 3000 }) } as never,
      undefined,
      { settingsPanel: route },
    ) as unknown as { _getHtmlForWebview: (webview: unknown) => string }
    return () =>
      provider._getHtmlForWebview({
        cspSource: "vscode-resource://test",
        asWebviewUri: (uri: { fsPath: string }) => ({ toString: () => `vscode-resource://${uri.fsPath}` }),
      })
  }

  it("starts the current Settings route directly, including after a reload", () => {
    let tab = "indexing"
    const render = html(() => ({ tab, projectId: "</script><script>bad()</script>" }))
    const first = render()
    expect(first).toContain("/dist/settings.js")
    expect(first).toContain("/dist/settings.css")
    expect(first).toContain('type="module"')
    expect(first).toContain('window.KILO_SETTINGS = {"tab":"indexing"')
    expect(first).toContain('"projectId":"\\u003c/script>')
    expect(first).not.toContain("<script>bad()")
    tab = "display"
    expect(render()).toContain('window.KILO_SETTINGS = {"tab":"display"')
  })

  it("keeps the ordinary chat entry and script policy unchanged", () => {
    const result = html()()
    expect(result).toContain("/dist/webview.js")
    expect(result).toContain("/dist/webview.css")
    expect(result).not.toContain('type="module"')
    expect(result).not.toContain("'strict-dynamic'")
  })
})

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

  it("allows imports from the trusted Settings module without allowing arbitrary script origins", () => {
    const result = buildCspString(cspSource, nonce, undefined, undefined, true)
    expect(result).toContain(`script-src 'nonce-${nonce}' 'wasm-unsafe-eval' 'strict-dynamic'`)
    expect(result).not.toContain("script-src https:")
    expect(buildCspString(cspSource, nonce)).not.toContain("'strict-dynamic'")
  })

  it("includes cspSource in style-src and font-src", () => {
    const result = buildCspString(cspSource, nonce)
    expect(result).toContain(`style-src 'unsafe-inline' ${cspSource}`)
    expect(result).toContain(`font-src ${cspSource}`)
  })

  it("allows only webview resources for the Shiki worker", () => {
    const result = buildCspString(cspSource, nonce)
    expect(result).toContain(`worker-src ${cspSource}`)
    expect(result).not.toContain(`worker-src ${cspSource} blob:`)
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

  it("includes cspSource in connect-src for source map loading", () => {
    const result = buildCspString(cspSource, nonce)
    expect(result).toMatch(new RegExp(`connect-src\\s+${cspSource.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`))
  })

  it("does not allow frames for ordinary webviews", () => {
    expect(buildCspString(cspSource, nonce)).not.toContain("frame-src")
  })

  it("limits Agent Manager browser frames to approved loopback origins", () => {
    const result = buildCspString(cspSource, nonce, undefined, "http://localhost:* http://127.0.0.1:*")
    expect(result).toContain("frame-src http://localhost:* http://127.0.0.1:*")
    expect(result).not.toContain("frame-src *")
    expect(result).not.toContain("frame-src https:")
  })

  it("joins directives with semicolons", () => {
    const result = buildCspString(cspSource, nonce)
    const parts = result.split(";")
    expect(parts.length).toBeGreaterThanOrEqual(5)
  })
})
