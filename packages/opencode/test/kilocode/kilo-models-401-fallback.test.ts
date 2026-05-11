// kilocode_change - new file
// Integration: when fetchKiloModels returns a 401 error result, ModelCache
// surfaces the failure and caches empty models (allowing re-auth via /connect).
// The real 401-fallback unit test lives in packages/kilo-gateway/test/api/models.test.ts.

import { test, expect, mock } from "bun:test"
import path from "path"
import * as Log from "@opencode-ai/core/util/log"

Log.init({ print: false })

// Simulate a 401 typed error result from the gateway
mock.module("@kilocode/kilo-gateway", () => ({
  fetchKiloModels: async () => ({
    models: {},
    error: { kind: "unauthorized", status: 401 },
  }),
  KILO_OPENROUTER_BASE: "https://api.kilo.ai/api/openrouter",
}))

mock.module("opencode-copilot-auth", () => ({ default: () => ({}) }))
mock.module("opencode-anthropic-auth", () => ({ default: () => ({}) }))
mock.module("@gitlab/opencode-gitlab-auth", () => ({ default: () => ({}) }))

import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { ModelCache } from "../../src/provider/model-cache"

const CONFIG = JSON.stringify({ $schema: "https://app.kilo.ai/config.json" })

async function withInstance<T>(fn: () => Promise<T>): Promise<T> {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "kilo.json"), CONFIG)
    },
  })
  return Instance.provide({ directory: tmp.path, fn })
}

test("401 from gateway sets provider as failed in ModelCache", async () => {
  ModelCache.clear("kilo")
  await withInstance(() => ModelCache.fetch("kilo"))
  expect(ModelCache.failedProviders()).toContain("kilo")
  expect(ModelCache.getFailure("kilo")).toMatchObject({ kind: "unauthorized", status: 401 })
})

test("401 from gateway caches empty models (not undefined)", async () => {
  ModelCache.clear("kilo")
  await withInstance(() => ModelCache.fetch("kilo"))
  const cached = ModelCache.get("kilo")
  expect(cached).toBeDefined()
  expect(Object.keys(cached!)).toHaveLength(0)
})
