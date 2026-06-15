import { describe, expect, it } from "bun:test"
import { engineBaseUrl } from "../../src/enterprise/gateway"
import type { EnterpriseSettings } from "../../src/enterprise/settings"

function ent(partial: Partial<EnterpriseSettings> & { remote: EnterpriseSettings["remote"] }): EnterpriseSettings {
  return {
    productName: "",
    gatewayUrl: "",
    license: {
      enabled: false,
      serverUrl: "",
      key: "",
      offlinePath: "",
      cacheHours: 24,
      graceDays: 7,
    },
    ...partial,
  }
}

describe("engineBaseUrl", () => {
  it("returns empty when remote disabled", () => {
    expect(engineBaseUrl(ent({ remote: { enabled: false, url: "http://x", password: "p" } }))).toBe("")
  })

  it("uses absolute remote URL", () => {
    expect(
      engineBaseUrl(
        ent({
          gatewayUrl: "http://gateway:9080",
          remote: { enabled: true, url: "http://engine:4096/", password: "p" },
        }),
      ),
    ).toBe("http://engine:4096")
  })

  it("joins gateway and path", () => {
    expect(
      engineBaseUrl(
        ent({
          gatewayUrl: "http://gateway:9080",
          remote: { enabled: true, url: "/kilo", password: "p" },
        }),
      ),
    ).toBe("http://gateway:9080/kilo")
  })
})
