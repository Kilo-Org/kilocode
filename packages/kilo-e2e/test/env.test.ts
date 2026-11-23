import { describe, expect, test } from "bun:test"
import { assertLoopbackOrigins, descriptorEnv, driverEnv, isLoopback, providerEnv } from "../src/env"
import { descriptor } from "./helpers"

describe("loopback origins", () => {
  test("accepts explicit loopback origins", () => {
    expect(isLoopback("http://localhost:43100")).toBe(true)
    expect(isLoopback("http://127.0.0.1:43100")).toBe(true)
    expect(isLoopback("ws://[::1]:43100")).toBe(true)
  })

  test("rejects production and non-loopback schemes", () => {
    expect(isLoopback("https://api.kilo.ai")).toBe(false)
    expect(isLoopback("http://example.com")).toBe(false)
    expect(isLoopback("file:///tmp/socket")).toBe(false)
  })

  test("validates every descriptor origin", () => {
    expect(() => assertLoopbackOrigins(descriptor().origins)).not.toThrow()
    expect(() => assertLoopbackOrigins({ ...descriptor().origins, web: "https://api.kilo.ai" })).toThrow()
  })
})

describe("descriptor environment", () => {
  test("maps origins, credentials, and isolated state", () => {
    const env = descriptorEnv(descriptor())
    expect(env.KILO_API_URL).toBe("http://127.0.0.1:43100")
    expect(env.KILO_WEB_APP_URL).toBe("http://127.0.0.1:43100")
    expect(env.CLOUD_AGENT_NEXT_BASE_URL).toBe("http://127.0.0.1:43101")
    expect(env.KILO_SESSION_INGEST_URL).toBe("http://127.0.0.1:43102")
    expect(env.EVENT_SERVICE_URL).toBe("ws://127.0.0.1:43103")
    expect(env.KILO_AI_GATEWAY_URL).toBe("http://127.0.0.1:43104")
    expect(env.KILO_API_KEY).toBe("fake-key")
    expect(env.KILO_ORG_ID).toBe("org-fake")
    expect(env.XDG_DATA_HOME).toBe("/tmp/data")
    expect(env.XDG_CONFIG_HOME).toBe("/tmp/config")
    expect(env.XDG_STATE_HOME).toBe("/tmp/state")
    expect(env.XDG_CACHE_HOME).toBe("/tmp/cache")
    expect(env.KILO_DISABLE_AUTOUPDATE).toBe("1")
  })

  test("disables absent optional services", () => {
    const empty = descriptor()
    const env = descriptorEnv({
      ...empty,
      origins: { web: empty.origins.web, cloudAgent: empty.origins.cloudAgent, fakeLlm: empty.origins.fakeLlm },
    })
    expect(env.KILO_SESSION_INGEST_URL).toBeUndefined()
    expect(env.KILO_DISABLE_SESSION_INGEST).toBe("1")
    expect(env.EVENT_SERVICE_URL).toBeUndefined()
    expect(env.KILO_DISABLE_PRESENCE).toBe("1")
    expect(env.KILO_AI_GATEWAY_URL).toBeUndefined()
  })

  test("strips ambient Kilo credentials before applying the descriptor", () => {
    const previous = process.env.KILO_API_KEY
    process.env.KILO_API_KEY = "ambient-secret"
    try {
      expect(providerEnv().KILO_API_KEY).toBeUndefined()
      expect(driverEnv(descriptor()).KILO_API_KEY).toBe("fake-key")
    } finally {
      if (previous === undefined) delete process.env.KILO_API_KEY
      else process.env.KILO_API_KEY = previous
    }
  })
})
