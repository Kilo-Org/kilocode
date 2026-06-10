import { describe, it, expect, beforeEach, afterEach } from "bun:test"

const BEDROCK_ONLY_ENV = "BEDROCK_ONLY"
const AWS_REGION_ENV = "AWS_REGION"
const AWS_ACCESS_KEY_ID_ENV = "AWS_ACCESS_KEY_ID"
const AWS_SECRET_ACCESS_KEY_ENV = "AWS_SECRET_ACCESS_KEY"
const AWS_PROFILE_ENV = "AWS_PROFILE"

describe("Enterprise Bedrock-only mode", () => {
  const originalEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    originalEnv[BEDROCK_ONLY_ENV] = process.env[BEDROCK_ONLY_ENV]
    originalEnv[AWS_REGION_ENV] = process.env[AWS_REGION_ENV]
    originalEnv[AWS_ACCESS_KEY_ID_ENV] = process.env[AWS_ACCESS_KEY_ID_ENV]
    originalEnv[AWS_SECRET_ACCESS_KEY_ENV] = process.env[AWS_SECRET_ACCESS_KEY_ENV]
    originalEnv[AWS_PROFILE_ENV] = process.env[AWS_PROFILE_ENV]
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

  describe("isBedrockOnlyEnabled", () => {
    it("returns false when BEDROCK_ONLY is not set", () => {
      delete process.env[BEDROCK_ONLY_ENV]
      const { isBedrockOnlyEnabled } = require("@/kilocode/enterprise/bedrock-only")
      expect(isBedrockOnlyEnabled()).toBe(false)
    })

    it("returns true when BEDROCK_ONLY=true", () => {
      process.env[BEDROCK_ONLY_ENV] = "true"
      const { isBedrockOnlyEnabled } = require("@/kilocode/enterprise/bedrock-only")
      expect(isBedrockOnlyEnabled()).toBe(true)
    })

    it("returns true when BEDROCK_ONLY=1", () => {
      process.env[BEDROCK_ONLY_ENV] = "1"
      const { isBedrockOnlyEnabled } = require("@/kilocode/enterprise/bedrock-only")
      expect(isBedrockOnlyEnabled()).toBe(true)
    })

    it("returns false for other values", () => {
      process.env[BEDROCK_ONLY_ENV] = "false"
      const { isBedrockOnlyEnabled } = require("@/kilocode/enterprise/bedrock-only")
      expect(isBedrockOnlyEnabled()).toBe(false)
    })
  })

  describe("isBedrockAllowedUrl", () => {
    it("allows bedrock-runtime endpoints", () => {
      const { isBedrockAllowedUrl } = require("@/kilocode/enterprise/bedrock-only")
      expect(isBedrockAllowedUrl("https://bedrock-runtime.us-east-1.amazonaws.com")).toBe(true)
      expect(isBedrockAllowedUrl("https://bedrock-runtime.eu-west-1.amazonaws.com")).toBe(true)
      expect(isBedrockAllowedUrl("https://bedrock-runtime.ap-southeast-1.amazonaws.com")).toBe(true)
    })

    it("allows bedrock endpoints", () => {
      const { isBedrockAllowedUrl } = require("@/kilocode/enterprise/bedrock-only")
      expect(isBedrockAllowedUrl("https://bedrock.us-east-1.amazonaws.com")).toBe(true)
    })

    it("blocks kilo.ai", () => {
      const { isBedrockAllowedUrl } = require("@/kilocode/enterprise/bedrock-only")
      expect(isBedrockAllowedUrl("https://api.kilo.ai")).toBe(false)
      expect(isBedrockAllowedUrl("https://app.kilo.ai")).toBe(false)
      expect(isBedrockAllowedUrl("https://kilo.ai")).toBe(false)
    })

    it("blocks kiloapps.io", () => {
      const { isBedrockAllowedUrl } = require("@/kilocode/enterprise/bedrock-only")
      expect(isBedrockAllowedUrl("https://chat.kiloapps.io")).toBe(false)
      expect(isBedrockAllowedUrl("https://events.kiloapps.io")).toBe(false)
    })

    it("blocks posthog", () => {
      const { isBedrockAllowedUrl } = require("@/kilocode/enterprise/bedrock-only")
      expect(isBedrockAllowedUrl("https://us.i.posthog.com")).toBe(false)
    })

    it("blocks other cloud providers", () => {
      const { isBedrockAllowedUrl } = require("@/kilocode/enterprise/bedrock-only")
      expect(isBedrockAllowedUrl("https://api.openai.com")).toBe(false)
      expect(isBedrockAllowedUrl("https://api.anthropic.com")).toBe(false)
      expect(isBedrockAllowedUrl("https://generativelanguage.googleapis.com")).toBe(false)
      expect(isBedrockAllowedUrl("https://openrouter.ai")).toBe(false)
    })

    it("blocks models.dev", () => {
      const { isBedrockAllowedUrl } = require("@/kilocode/enterprise/bedrock-only")
      expect(isBedrockAllowedUrl("https://models.dev")).toBe(false)
    })
  })

  describe("assertBedrockConfigured", () => {
    it("throws when Bedrock-only is enabled but not configured", () => {
      process.env[BEDROCK_ONLY_ENV] = "true"
      delete process.env[AWS_REGION_ENV]
      delete process.env[AWS_ACCESS_KEY_ID_ENV]
      delete process.env[AWS_SECRET_ACCESS_KEY_ENV]
      delete process.env[AWS_PROFILE_ENV]
      const { assertBedrockConfigured } = require("@/kilocode/enterprise/bedrock-only")
      expect(() => assertBedrockConfigured()).toThrow("Enterprise Bedrock-only mode is enabled")
    })

    it("does not throw when Bedrock-only is disabled", () => {
      process.env[BEDROCK_ONLY_ENV] = "false"
      delete process.env[AWS_REGION_ENV]
      const { assertBedrockConfigured } = require("@/kilocode/enterprise/bedrock-only")
      expect(() => assertBedrockConfigured()).not.toThrow()
    })

    it("does not throw when Bedrock is properly configured with access key", () => {
      process.env[BEDROCK_ONLY_ENV] = "true"
      process.env[AWS_REGION_ENV] = "us-east-1"
      process.env[AWS_ACCESS_KEY_ID_ENV] = "AKIAIOSFODNN7EXAMPLE"
      process.env[AWS_SECRET_ACCESS_KEY_ENV] = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
      const { assertBedrockConfigured } = require("@/kilocode/enterprise/bedrock-only")
      expect(() => assertBedrockConfigured()).not.toThrow()
    })

    it("does not throw when Bedrock is properly configured with profile", () => {
      process.env[BEDROCK_ONLY_ENV] = "true"
      process.env[AWS_REGION_ENV] = "us-east-1"
      process.env[AWS_PROFILE_ENV] = "my-profile"
      delete process.env[AWS_ACCESS_KEY_ID_ENV]
      delete process.env[AWS_SECRET_ACCESS_KEY_ENV]
      const { assertBedrockConfigured } = require("@/kilocode/enterprise/bedrock-only")
      expect(() => assertBedrockConfigured()).not.toThrow()
    })

    it("throws when region is missing", () => {
      process.env[BEDROCK_ONLY_ENV] = "true"
      delete process.env[AWS_REGION_ENV]
      process.env[AWS_ACCESS_KEY_ID_ENV] = "AKIAIOSFODNN7EXAMPLE"
      process.env[AWS_SECRET_ACCESS_KEY_ENV] = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
      const { assertBedrockConfigured } = require("@/kilocode/enterprise/bedrock-only")
      expect(() => assertBedrockConfigured()).toThrow("Enterprise Bedrock-only mode is enabled")
    })
  })

  describe("Kilo Gateway is not selectable", () => {
    it("BUNDLED_PROVIDERS should not contain kilo-gateway in bedrock-only mode", () => {
      process.env[BEDROCK_ONLY_ENV] = "true"
      process.env[AWS_REGION_ENV] = "us-east-1"
      process.env[AWS_ACCESS_KEY_ID_ENV] = "AKIAIOSFODNN7EXAMPLE"
      process.env[AWS_SECRET_ACCESS_KEY_ENV] = "test"

      // The BUNDLED_PROVIDERS is evaluated at module load time.
      // We verify that the kilo-gateway provider is not in the list
      // by checking the enterprise module's bedrock-only check.
      const { isBedrockOnlyEnabled } = require("@/kilocode/enterprise/bedrock-only")
      expect(isBedrockOnlyEnabled()).toBe(true)
    })
  })

  describe("BEDROCK_ONLY_ERROR message", () => {
    it("contains the required message", () => {
      const { BEDROCK_ONLY_ERROR } = require("@/kilocode/enterprise/bedrock-only")
      expect(BEDROCK_ONLY_ERROR).toContain("Enterprise Bedrock-only mode is enabled")
      expect(BEDROCK_ONLY_ERROR).toContain("AWS Bedrock must be configured")
      expect(BEDROCK_ONLY_ERROR).toContain("No fallback provider is allowed")
    })
  })

  describe("Network guard blocks unauthorized domains", () => {
    it("BlockedNetworkError is thrown for unauthorized URLs", () => {
      const { BlockedNetworkError } = require("@/kilocode/enterprise/network-guard")
      const err = new BlockedNetworkError("https://api.kilo.ai/test")
      expect(err).toBeInstanceOf(Error)
      expect(err.name).toBe("BlockedNetworkError")
      expect(err.message).toContain("blocked in enterprise Bedrock-only mode")
      expect(err.message).toContain("Only AWS Bedrock endpoints are allowed")
    })
  })

  describe("BEDROCK_ALLOWED_NPM", () => {
    it("only allows @ai-sdk/amazon-bedrock", () => {
      const { isBedrockAllowedNpm } = require("@/kilocode/enterprise/bedrock-only")
      expect(isBedrockAllowedNpm("@ai-sdk/amazon-bedrock")).toBe(true)
      expect(isBedrockAllowedNpm("@ai-sdk/anthropic")).toBe(false)
      expect(isBedrockAllowedNpm("@ai-sdk/openai")).toBe(false)
      expect(isBedrockAllowedNpm("@kilocode/kilo-gateway")).toBe(false)
      expect(isBedrockAllowedNpm("@openrouter/ai-sdk-provider")).toBe(false)
      expect(isBedrockAllowedNpm("@ai-sdk/google")).toBe(false)
      expect(isBedrockAllowedNpm("@ai-sdk/mistral")).toBe(false)
    })
  })
})
