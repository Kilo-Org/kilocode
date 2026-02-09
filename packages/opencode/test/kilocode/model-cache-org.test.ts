// kilocode_change - new file
// Regression test: OAuth accountId must flow into model fetch as kilocodeOrganizationId
// When a user logs in via OAuth and selects an enterprise organization, the model fetch
// should use the organization-specific endpoint, not the personal endpoint.

import { test, expect, mock } from "bun:test"
import path from "path"

// Capture the options passed to fetchKiloModels
let captured: any = undefined

mock.module("@kilocode/kilo-gateway", () => ({
  fetchKiloModels: async (options: any) => {
    captured = options
    return {
      "test-model": {
        id: "test-model",
        name: "Test Model",
        cost: { input: 0.001, output: 0.002 },
        limit: { context: 128000, output: 4096 },
      },
    }
  },
  KILO_OPENROUTER_BASE: "https://api.kilo.ai/api/openrouter",
}))

// Mock BunProc and default plugins to prevent actual installations during tests
mock.module("../../src/bun/index", () => ({
  BunProc: {
    install: async (pkg: string) => {
      const lastAtIndex = pkg.lastIndexOf("@")
      return lastAtIndex > 0 ? pkg.substring(0, lastAtIndex) : pkg
    },
    run: async () => {
      throw new Error("BunProc.run should not be called in tests")
    },
    which: () => process.execPath,
    InstallFailedError: class extends Error {},
  },
}))

const mockPlugin = () => ({})
mock.module("opencode-copilot-auth", () => ({ default: mockPlugin }))
mock.module("opencode-anthropic-auth", () => ({ default: mockPlugin }))
mock.module("@gitlab/opencode-gitlab-auth", () => ({ default: mockPlugin }))

import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Auth } from "../../src/auth"
import { ModelCache } from "../../src/provider/model-cache"

test("model fetch uses accountId from OAuth auth as kilocodeOrganizationId", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      // Simulate an OAuth login where user selected an enterprise organization
      await Auth.set("kilo", {
        type: "oauth",
        access: "test-oauth-token",
        refresh: "test-refresh-token",
        expires: Date.now() + 3600000,
        accountId: "org-enterprise-123",
      })
    },
    fn: async () => {
      // Reset captured and cache
      captured = undefined
      ModelCache.clear("kilo")

      // Trigger model fetch through the cache
      await ModelCache.fetch("kilo")

      // The fetchKiloModels call should have received the organization ID
      expect(captured).toBeDefined()
      expect(captured.kilocodeToken).toBe("test-oauth-token")
      expect(captured.kilocodeOrganizationId).toBe("org-enterprise-123")
    },
  })
})

test("model fetch without OAuth accountId does not set kilocodeOrganizationId", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      // Simulate an OAuth login for a personal account (no accountId)
      await Auth.set("kilo", {
        type: "oauth",
        access: "test-personal-token",
        refresh: "test-refresh-token",
        expires: Date.now() + 3600000,
      })
    },
    fn: async () => {
      captured = undefined
      ModelCache.clear("kilo")

      await ModelCache.fetch("kilo")

      expect(captured).toBeDefined()
      expect(captured.kilocodeToken).toBe("test-personal-token")
      expect(captured.kilocodeOrganizationId).toBeUndefined()
    },
  })
})
