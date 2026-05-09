import { describe, it, expect, afterEach } from "bun:test"
import * as vscode from "vscode"
import { buildProxyEnv, normalizeProxyEnv } from "../../src/services/cli-backend/server-manager"

type Info = { globalValue?: unknown; workspaceValue?: unknown; workspaceFolderValue?: unknown }
type WorkspaceStub = {
  getConfiguration: (section?: string) => { get: (key: string) => unknown; inspect: (key: string) => Info }
}

const workspace = vscode.workspace as unknown as WorkspaceStub
const originalGetConfiguration = workspace.getConfiguration

function stubHttpConfig(values: { proxy?: unknown; noProxy?: unknown; proxySupport?: unknown }): void {
  workspace.getConfiguration = (section?: string) => {
    if (section === "http") {
      return {
        get: (key: string) => {
          if (key === "proxy") return values.proxy
          if (key === "noProxy") return values.noProxy
          if (key === "proxySupport") return values.proxySupport
          return undefined
        },
        inspect: (key: string) => {
          if (key === "proxy" && values.proxy !== undefined) return { workspaceValue: values.proxy }
          if (key === "noProxy" && values.noProxy !== undefined) return { workspaceValue: values.noProxy }
          if (key === "proxySupport" && values.proxySupport !== undefined)
            return { workspaceValue: values.proxySupport }
          return {}
        },
      }
    }
    return { get: () => undefined, inspect: () => ({}) }
  }
}

afterEach(() => {
  workspace.getConfiguration = originalGetConfiguration
})

describe("buildProxyEnv", () => {
  it("returns an empty object when neither proxy nor noProxy is configured", () => {
    stubHttpConfig({ proxy: undefined, noProxy: undefined })

    expect(buildProxyEnv()).toEqual({})
  })

  it("forwards http.proxy as HTTP_PROXY and HTTPS_PROXY", () => {
    stubHttpConfig({ proxy: "http://proxy.corp.example:8080" })

    expect(buildProxyEnv()).toEqual({
      HTTP_PROXY: "http://proxy.corp.example:8080",
      HTTPS_PROXY: "http://proxy.corp.example:8080",
      http_proxy: "http://proxy.corp.example:8080",
      https_proxy: "http://proxy.corp.example:8080",
    })
  })

  it("joins http.noProxy into a comma-separated NO_PROXY value", () => {
    stubHttpConfig({ noProxy: ["localhost", "127.0.0.1", "*.internal"] })

    expect(buildProxyEnv()).toEqual({
      NO_PROXY: "localhost,127.0.0.1,*.internal",
      no_proxy: "localhost,127.0.0.1,*.internal",
    })
  })

  it("forwards both proxy and noProxy when both are configured", () => {
    stubHttpConfig({
      proxy: "http://proxy.corp.example:8080",
      noProxy: ["localhost", "*.internal"],
    })

    expect(buildProxyEnv()).toEqual({
      HTTP_PROXY: "http://proxy.corp.example:8080",
      HTTPS_PROXY: "http://proxy.corp.example:8080",
      NO_PROXY: "localhost,*.internal",
      http_proxy: "http://proxy.corp.example:8080",
      https_proxy: "http://proxy.corp.example:8080",
      no_proxy: "localhost,*.internal",
    })
  })

  it("clears env vars when http.proxy is only whitespace", () => {
    stubHttpConfig({ proxy: "   " })

    expect(buildProxyEnv()).toEqual({
      HTTP_PROXY: "",
      HTTPS_PROXY: "",
      http_proxy: "",
      https_proxy: "",
    })
  })

  it("clears env var when http.noProxy is an empty array", () => {
    stubHttpConfig({ noProxy: [] })

    expect(buildProxyEnv()).toEqual({
      NO_PROXY: "",
      no_proxy: "",
    })
  })

  it("ignores a non-array http.noProxy value", () => {
    stubHttpConfig({ noProxy: "localhost" })

    expect(buildProxyEnv()).toEqual({})
  })

  it("explicitly clears env vars when http.proxySupport is off", () => {
    stubHttpConfig({ proxySupport: "off" })

    expect(buildProxyEnv()).toEqual({
      HTTP_PROXY: "",
      HTTPS_PROXY: "",
      NO_PROXY: "",
      http_proxy: "",
      https_proxy: "",
      no_proxy: "",
    })
  })

  it("http.proxySupport=off wins over a configured http.proxy/http.noProxy", () => {
    stubHttpConfig({
      proxy: "http://proxy.corp.example:8080",
      noProxy: ["localhost"],
      proxySupport: "off",
    })

    expect(buildProxyEnv()).toEqual({
      HTTP_PROXY: "",
      HTTPS_PROXY: "",
      NO_PROXY: "",
      http_proxy: "",
      https_proxy: "",
      no_proxy: "",
    })
  })
})

describe("normalizeProxyEnv", () => {
  it("mirrors a Remote-SSH lowercase http_proxy into HTTPS and uppercase variants", () => {
    expect(normalizeProxyEnv({ http_proxy: "http://127.0.0.1:58119//" })).toEqual({
      HTTP_PROXY: "http://127.0.0.1:58119",
      HTTPS_PROXY: "http://127.0.0.1:58119",
      http_proxy: "http://127.0.0.1:58119",
      https_proxy: "http://127.0.0.1:58119",
    })
  })

  it("mirrors uppercase HTTPS and ALL proxy values into lowercase variants", () => {
    expect(
      normalizeProxyEnv({
        HTTPS_PROXY: "http://proxy.corp.example:8443/",
        ALL_PROXY: "socks5h://127.0.0.1:58120/",
      }),
    ).toEqual({
      HTTPS_PROXY: "http://proxy.corp.example:8443",
      https_proxy: "http://proxy.corp.example:8443",
      ALL_PROXY: "socks5h://127.0.0.1:58120",
      all_proxy: "socks5h://127.0.0.1:58120",
    })
  })

  it("mirrors no_proxy casing without URL normalization", () => {
    expect(normalizeProxyEnv({ no_proxy: "localhost,127.0.0.1,10.0.0.0/8" })).toEqual({
      NO_PROXY: "localhost,127.0.0.1,10.0.0.0/8",
      no_proxy: "localhost,127.0.0.1,10.0.0.0/8",
    })
  })

  it("preserves explicit empty proxy clears", () => {
    expect(
      normalizeProxyEnv({
        HTTP_PROXY: "",
        HTTPS_PROXY: "",
        http_proxy: "",
        https_proxy: "",
      }),
    ).toEqual({
      HTTP_PROXY: "",
      HTTPS_PROXY: "",
      http_proxy: "",
      https_proxy: "",
    })
  })

  it("does not derive HTTPS from ambient HTTP proxy when HTTPS proxy was explicitly cleared", () => {
    expect(
      normalizeProxyEnv({
        http_proxy: "http://ambient.example:3128",
        HTTPS_PROXY: "",
        https_proxy: "",
      }),
    ).toEqual({
      HTTP_PROXY: "http://ambient.example:3128",
      http_proxy: "http://ambient.example:3128",
      HTTPS_PROXY: "",
      https_proxy: "",
    })
  })
})
