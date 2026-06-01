import { describe, expect, it } from "bun:test"
import { remoteEndpoint } from "../../src/enterprise/remote-server"

describe("remoteEndpoint", () => {
  it("returns null when disabled", () => {
    expect(remoteEndpoint({ enabled: false, url: "http://x:1", password: "p" })).toBeNull()
  })

  it("returns null without password", () => {
    expect(remoteEndpoint({ enabled: true, url: "http://127.0.0.1:4096", password: "" })).toBeNull()
  })

  it("parses url and default http port", () => {
    const ep = remoteEndpoint({
      enabled: true,
      url: "http://engine.internal:4096/",
      password: "secret",
    })
    expect(ep).toEqual({
      baseUrl: "http://engine.internal:4096",
      port: 4096,
      password: "secret",
    })
  })

  it("uses 443 for https without explicit port", () => {
    const ep = remoteEndpoint({
      enabled: true,
      url: "https://gateway.example.com/kilo",
      password: "secret",
    })
    expect(ep?.port).toBe(443)
    expect(ep?.baseUrl).toBe("https://gateway.example.com/kilo")
  })
})
