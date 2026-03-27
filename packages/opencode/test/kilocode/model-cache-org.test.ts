// Regression tests for model-cache auth options resolution.
// Verifies that OAuth accountId flows as kilocodeOrganizationId, that kilocodeToken
// is read from provider config, and that cache invalidation works correctly.

import { test, expect, mock, beforeAll, afterAll, beforeEach } from "bun:test"
import path from "path"
import fs from "fs/promises"

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
import { Env } from "../../src/env"
import { ModelCache } from "../../src/provider/model-cache"

// Isolate the entire file from KILO_CONFIG_CONTENT injected by the cloud-agent
// harness.  Saved once, restored once — individual tests stay side-effect-free.
const savedEnv: Record<string, string | undefined> = {}

beforeAll(() => {
  for (const key of ["KILO_CONFIG_CONTENT", "OPENCODE_CONFIG_CONTENT"]) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
})

afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value !== undefined) process.env[key] = value
    else delete process.env[key]
  }
})

beforeEach(() => {
  captured = undefined
  ModelCache.clear("kilo")
})

test("model fetch uses accountId from OAuth auth as kilocodeOrganizationId", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      await Auth.set("kilo", {
        type: "oauth",
        access: "test-oauth-token",
        refresh: "test-refresh-token",
        expires: Date.now() + 3600000,
        accountId: "org-enterprise-123",
      })
    },
    fn: async () => {
      await ModelCache.fetch("kilo")

      expect(captured).toBeDefined()
      expect(captured.kilocodeToken).toBe("test-oauth-token")
      expect(captured.kilocodeOrganizationId).toBe("org-enterprise-123")
    },
  })
})

test("model fetch without OAuth accountId does not set kilocodeOrganizationId", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      await Auth.set("kilo", {
        type: "oauth",
        access: "test-personal-token",
        refresh: "test-refresh-token",
        expires: Date.now() + 3600000,
      })
    },
    fn: async () => {
      await ModelCache.fetch("kilo")

      expect(captured).toBeDefined()
      expect(captured.kilocodeToken).toBe("test-personal-token")
      expect(captured.kilocodeOrganizationId).toBeUndefined()
    },
  })
})

test("model fetch uses kilocodeToken from provider config options", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      // .opencode/ is traversed by the config loader from Instance.directory upward
      const opencodeDir = path.join(dir, ".opencode")
      await fs.mkdir(opencodeDir)
      await Bun.write(
        path.join(opencodeDir, "opencode.json"),
        JSON.stringify({
          provider: { kilo: { options: { kilocodeToken: "opencode-dir-token" } } },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      await Auth.remove("kilo")
      Env.remove("KILO_API_KEY")
    },
    fn: async () => {
      await ModelCache.fetch("kilo")

      expect(captured).toBeDefined()
      expect(captured.kilocodeToken).toBe("opencode-dir-token")
    },
  })
})

test("ModelCache.clear removes cached entry so next fetch hits the network", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      await Auth.set("kilo", {
        type: "oauth",
        access: "token-clear-test",
        refresh: "refresh-clear",
        expires: Date.now() + 3600000,
        accountId: "org-clear",
      })
    },
    fn: async () => {
      // Populate cache
      await ModelCache.fetch("kilo")
      expect(captured).toBeDefined()

      // Second fetch should come from cache — no new fetchKiloModels call
      captured = undefined
      await ModelCache.fetch("kilo")
      expect(captured).toBeUndefined()
      expect(ModelCache.get("kilo")).toBeDefined()

      // After clear, get() returns undefined
      ModelCache.clear("kilo")
      expect(ModelCache.get("kilo")).toBeUndefined()

      // Next fetch should call fetchKiloModels again
      await ModelCache.fetch("kilo")
      expect(captured).toBeDefined()
    },
  })
})
