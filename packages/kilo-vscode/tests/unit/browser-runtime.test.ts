import { describe, expect, test } from "bun:test"
import { options } from "../../src/services/browser-automation/browser-runtime"

describe("browser runtime isolation", () => {
  test("removes proxy settings and secrets while preserving normal environment values", () => {
    const env = Object.freeze({
      PATH: "/usr/bin",
      HOME: "/home/test",
      LANG: "en_US.UTF-8",
      HTTP_PROXY: "http://proxy.invalid:8080",
      HTTPS_PROXY: "http://proxy.invalid:8080",
      ALL_PROXY: "socks5://proxy.invalid:1080",
      NO_PROXY: "",
      http_proxy: "http://proxy.invalid:8080",
      Https_Proxy: "http://proxy.invalid:8080",
      npm_config_proxy: "http://proxy.invalid:8080",
      GLOBAL_AGENT_HTTP_PROXY: "http://proxy.invalid:8080",
      API_KEY: "test-key",
      KILO_BROWSER_BROKER_TOKEN: "test-token",
      DATABASE_PASSWORD: "test-password",
    })
    const config = options(true, 9222, env)
    expect(config.env).toEqual({ PATH: "/usr/bin", HOME: "/home/test", LANG: "en_US.UTF-8" })
    expect(env.HTTP_PROXY).toBe("http://proxy.invalid:8080")
    expect(config.chromiumSandbox).toBe(true)
    expect(config.headless).toBe(true)
    expect(config.channel).toBe("chrome")
  })

  test("forces direct Chromium networking without disabling localhost bypass", () => {
    const config = options(true, 9222, {})
    expect(config.args).toEqual([
      "--no-proxy-server",
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=9222",
    ])
    expect(config.args?.some((arg) => arg.includes("<-loopback>"))).toBe(false)
  })

  test("uses the same proxy isolation for installed Playwright Chromium", () => {
    const config = options(false, undefined, { http_proxy: "http://proxy.invalid", PATH: "/bin" })
    expect(config.channel).toBeUndefined()
    expect(config.env).toEqual({ PATH: "/bin" })
    expect(config.args).toEqual(["--no-proxy-server"])
  })
})
