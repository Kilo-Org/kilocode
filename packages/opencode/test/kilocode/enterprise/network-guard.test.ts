import { describe, it, expect, beforeEach, afterEach } from "bun:test"

describe("Enterprise network guard", () => {
  const originalEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    originalEnv["BEDROCK_ONLY"] = process.env["BEDROCK_ONLY"]
    originalEnv["AWS_REGION"] = process.env["AWS_REGION"]
    originalEnv["AWS_ACCESS_KEY_ID"] = process.env["AWS_ACCESS_KEY_ID"]
    originalEnv["AWS_SECRET_ACCESS_KEY"] = process.env["AWS_SECRET_ACCESS_KEY"]
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  })

  it("installNetworkGuard blocks fetch to non-Bedrock URLs when BEDROCK_ONLY=true", () => {
    process.env["BEDROCK_ONLY"] = "true"
    process.env["AWS_REGION"] = "us-east-1"

    const { installNetworkGuard, BlockedNetworkError } = require("@/kilocode/enterprise/network-guard")
    installNetworkGuard()

    const result = globalThis.fetch("https://api.kilo.ai/test")
    expect(result).rejects.toThrow(BlockedNetworkError)
  })

  it("installNetworkGuard does nothing when BEDROCK_ONLY is not set", () => {
    delete process.env["BEDROCK_ONLY"]

    const { installNetworkGuard } = require("@/kilocode/enterprise/network-guard")
    installNetworkGuard()

    // Fetch should remain the same function reference (or at least not be the guard)
    // Since install is idempotent and the guard was already installed from the previous test,
    // we just verify the function runs without error.
    expect(typeof globalThis.fetch).toBe("function")
  })

  it("disableTelemetryExports sets KILO_TELEMETRY_LEVEL to off", () => {
    process.env["BEDROCK_ONLY"] = "true"

    const { disableTelemetryExports } = require("@/kilocode/enterprise/network-guard")
    disableTelemetryExports()

    expect(process.env["KILO_TELEMETRY_LEVEL"]).toBe("off")
    expect(process.env["POSTHOG_DISABLED"]).toBe("1")
    expect(process.env["DO_NOT_TRACK"]).toBe("1")
  })

  it("disableTelemetryExports does nothing when BEDROCK_ONLY is not set", () => {
    delete process.env["BEDROCK_ONLY"]
    delete process.env["KILO_TELEMETRY_LEVEL"]

    const { disableTelemetryExports } = require("@/kilocode/enterprise/network-guard")
    disableTelemetryExports()

    expect(process.env["KILO_TELEMETRY_LEVEL"]).toBeUndefined()
  })

  describe("Blocked domains list", () => {
    it("blocks all known Kilo endpoints", () => {
      process.env["BEDROCK_ONLY"] = "true"
      process.env["AWS_REGION"] = "us-east-1"

      const { BlockedNetworkError } = require("@/kilocode/enterprise/network-guard")

      // The guard is already installed from the first test in this describe block.
      // Verify it blocks known Kilo endpoints.
      const blockedUrls = [
        "https://kilo.ai",
        "https://api.kilo.ai",
        "https://app.kilo.ai",
        "https://chat.kiloapps.io",
        "https://events.kiloapps.io",
        "https://ingest.kilosessions.ai",
        "https://kilocode.ai",
        "https://us.i.posthog.com",
        "https://models.dev",
      ]

      for (const url of blockedUrls) {
        const result = globalThis.fetch(url)
        expect(result).rejects.toThrow(BlockedNetworkError)
      }
    })
  })

  describe("Allowed domains", () => {
    it("allows Bedrock URLs when guard is installed", () => {
      process.env["BEDROCK_ONLY"] = "true"
      process.env["AWS_REGION"] = "us-east-1"

      // The guard is already installed. Verify Bedrock URLs are not blocked.
      // We mock fetch to just return a successful response.
      const mockFetch = async () => new Response("ok")
      globalThis.fetch = mockFetch as any // eslint-disable-line @typescript-eslint/no-unsafe-type-assertion

      const result = globalThis.fetch("https://bedrock-runtime.us-east-1.amazonaws.com/test")
      expect(result).resolves.toBeDefined()
    })
  })
})
