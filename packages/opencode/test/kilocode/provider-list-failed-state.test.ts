// kilocode_change - new file
// Verifies that:
//   1. ModelCache.failedProviders() surfaces providers that encountered errors.
//   2. ModelCache.getFailure() returns the typed error for a failed provider.
//   3. Clear removes failure state.

import { test, expect, mock } from "bun:test"
import path from "path"
import * as Log from "@opencode-ai/core/util/log"

Log.init({ print: false })

// Stub fetchKiloModels to return controlled typed results.
let stubbedResult: { models: Record<string, any>; error?: { kind: string; status?: number } } = { models: {} }

mock.module("@kilocode/kilo-gateway", () => ({
  fetchKiloModels: async () => stubbedResult,
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

test("failedProviders returns empty array when no fetch has occurred", () => {
  ModelCache.clear("kilo")
  expect(ModelCache.failedProviders()).not.toContain("kilo")
})

test("getFailure returns undefined when fetch succeeds", async () => {
  stubbedResult = {
    models: {
      "test/model": { id: "test/model", name: "Test", cost: { input: 1, output: 2 }, limit: { context: 128000, output: 4096 } },
    },
  }
  ModelCache.clear("kilo")
  await withInstance(() => ModelCache.fetch("kilo"))
  expect(ModelCache.getFailure("kilo")).toBeUndefined()
  expect(ModelCache.failedProviders()).not.toContain("kilo")
})

test("failedProviders includes provider after auth error", async () => {
  stubbedResult = { models: {}, error: { kind: "unauthorized", status: 401 } }
  ModelCache.clear("kilo")
  await withInstance(() => ModelCache.fetch("kilo"))
  expect(ModelCache.failedProviders()).toContain("kilo")
  expect(ModelCache.getFailure("kilo")).toMatchObject({ kind: "unauthorized", status: 401 })
})

test("clear removes failure state", async () => {
  stubbedResult = { models: {}, error: { kind: "network" } }
  ModelCache.clear("kilo")
  await withInstance(() => ModelCache.fetch("kilo"))
  expect(ModelCache.failedProviders()).toContain("kilo")

  ModelCache.clear("kilo")
  expect(ModelCache.failedProviders()).not.toContain("kilo")
  expect(ModelCache.getFailure("kilo")).toBeUndefined()
})

test("failure state is cleared when subsequent fetch succeeds", async () => {
  stubbedResult = { models: {}, error: { kind: "unauthorized", status: 401 } }
  ModelCache.clear("kilo")
  await withInstance(() => ModelCache.fetch("kilo"))
  expect(ModelCache.failedProviders()).toContain("kilo")

  stubbedResult = {
    models: {
      "test/model": { id: "test/model", name: "Test", cost: { input: 1, output: 2 }, limit: { context: 128000, output: 4096 } },
    },
  }
  ModelCache.clear("kilo")
  await withInstance(() => ModelCache.fetch("kilo"))
  expect(ModelCache.failedProviders()).not.toContain("kilo")
  expect(ModelCache.getFailure("kilo")).toBeUndefined()
})
