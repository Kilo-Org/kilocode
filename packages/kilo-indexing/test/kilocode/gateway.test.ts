import { afterEach, describe, expect, test } from "bun:test"
import { resolveKiloGatewayBaseUrl } from "../../src/gateway"

const keys = ["KILO_AI_GATEWAY_URL", "KILO_API_URL"] as const
const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]))

afterEach(() => {
  for (const key of keys) {
    if (previous[key] === undefined) delete process.env[key]
    else process.env[key] = previous[key]
  }
})

describe("resolveKiloGatewayBaseUrl", () => {
  test("uses the configured AI gateway host when only KILO_AI_GATEWAY_URL is set", () => {
    delete process.env.KILO_API_URL
    process.env.KILO_AI_GATEWAY_URL = "https://gateway.example/api/v1"
    expect(resolveKiloGatewayBaseUrl()).toBe("https://gateway.example/api/v1/")
  })

  test("keeps the gateway route of a custom KILO_API_URL", () => {
    delete process.env.KILO_AI_GATEWAY_URL
    process.env.KILO_API_URL = "https://api.example"
    expect(resolveKiloGatewayBaseUrl()).toBe("https://api.example/api/gateway/v1/")
  })

  test("a development token URL still selects the legacy gateway route", () => {
    delete process.env.KILO_AI_GATEWAY_URL
    delete process.env.KILO_API_URL
    expect(resolveKiloGatewayBaseUrl({ token: "https://token.example:secret" })).toBe(
      "https://token.example/api/gateway/",
    )
  })
})
