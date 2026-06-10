import { describe, it, expect, beforeEach, afterEach } from "bun:test"

describe("Enterprise network guard — Bedrock eu-west-1 only", () => {
  const originalEnv: Record<string, string | undefined> = {}
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    originalEnv["BEDROCK_ONLY"] = process.env["BEDROCK_ONLY"]
    originalEnv["AWS_REGION"] = process.env["AWS_REGION"]
    originalEnv["AWS_ACCESS_KEY_ID"] = process.env["AWS_ACCESS_KEY_ID"]
    originalEnv["AWS_SECRET_ACCESS_KEY"] = process.env["AWS_SECRET_ACCESS_KEY"]
    globalThis.fetch = originalFetch
    // Reset guard state so each test gets a fresh guard
    const { _resetInstalledFlag } = require("@/kilocode/enterprise/network-guard")
    _resetInstalledFlag()
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
    globalThis.fetch = originalFetch
  })

  it("blocks fetch to non-Bedrock URLs when guard is installed", () => {
    process.env["BEDROCK_ONLY"] = "true"
    process.env["AWS_REGION"] = "eu-west-1"

    const { installNetworkGuard, BlockedNetworkError } = require("@/kilocode/enterprise/network-guard")
    installNetworkGuard()

    const result = globalThis.fetch("https://api.kilo.ai/test")
    expect(result).rejects.toThrow(BlockedNetworkError)
  })

  it("blocks Bedrock URLs in wrong region when guard is installed", () => {
    process.env["BEDROCK_ONLY"] = "true"
    process.env["AWS_REGION"] = "eu-west-1"

    const { installNetworkGuard, BlockedNetworkError } = require("@/kilocode/enterprise/network-guard")
    installNetworkGuard()

    const result = globalThis.fetch("https://bedrock-runtime.us-east-1.amazonaws.com/test")
    expect(result).rejects.toThrow(BlockedNetworkError)
  })

  it("isBedrockAllowedUrl allows only eu-west-1 endpoints", () => {
    const { isBedrockAllowedUrl } = require("@/kilocode/enterprise/bedrock-only")
    expect(isBedrockAllowedUrl("https://bedrock-runtime.eu-west-1.amazonaws.com")).toBe(true)
    expect(isBedrockAllowedUrl("https://bedrock.eu-west-1.amazonaws.com")).toBe(true)
    expect(isBedrockAllowedUrl("https://bedrock-runtime.us-east-1.amazonaws.com")).toBe(false)
    expect(isBedrockAllowedUrl("https://api.kilo.ai")).toBe(false)
  })

  it("does nothing when BEDROCK_ONLY is not set", () => {
    delete process.env["BEDROCK_ONLY"]

    const { installNetworkGuard } = require("@/kilocode/enterprise/network-guard")
    installNetworkGuard()

    expect(typeof globalThis.fetch).toBe("function")
  })

  it("disableTelemetryExports sets all telemetry-off env vars", () => {
    process.env["BEDROCK_ONLY"] = "true"

    const { disableTelemetryExports } = require("@/kilocode/enterprise/network-guard")
    disableTelemetryExports()

    expect(process.env["KILO_TELEMETRY_LEVEL"]).toBe("off")
    expect(process.env["POSTHOG_DISABLED"]).toBe("1")
    expect(process.env["DO_NOT_TRACK"]).toBe("1")
  })

  describe("All non-Bedrock domains are blocked by the guard", () => {
    it("blocks Kilo Gateway, PostHog, and other external endpoints", () => {
      process.env["BEDROCK_ONLY"] = "true"
      process.env["AWS_REGION"] = "eu-west-1"

      const { installNetworkGuard, BlockedNetworkError } = require("@/kilocode/enterprise/network-guard")
      installNetworkGuard()

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
        "https://api.openai.com",
        "https://api.anthropic.com",
        "https://generativelanguage.googleapis.com",
        "https://openrouter.ai",
        "https://bedrock-runtime.us-east-1.amazonaws.com",
        "https://bedrock-runtime.ap-southeast-1.amazonaws.com",
      ]

      for (const url of blockedUrls) {
        const result = globalThis.fetch(url)
        expect(result).rejects.toThrow(BlockedNetworkError)
      }
    })
  })
})
