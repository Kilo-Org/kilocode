// kilocode_change - new file
// Verifies that:
//   1. ModelCache.failedProviders() surfaces providers that encountered errors.
//   2. ModelCache.getFailure() returns the typed error for a failed provider.
//   3. Clear removes failure state.

import { beforeEach, test, expect, mock } from "bun:test"
import { Effect } from "effect"
import path from "path"
import * as Log from "@opencode-ai/core/util/log"

Log.init({ print: false })

// Stub fetchKiloModels to return controlled typed results.
let stubbedResult: { models: Record<string, any>; error?: { kind: string; status?: number } } = { models: {} }
let stubbedError: Error | undefined

mock.module("@kilocode/kilo-gateway", () => ({
  fetchKiloModels: async () => {
    if (stubbedError) throw stubbedError
    return stubbedResult
  },
  KILO_OPENROUTER_BASE: "https://api.kilo.ai/api/openrouter",
}))

mock.module("opencode-copilot-auth", () => ({ default: () => ({}) }))
mock.module("opencode-anthropic-auth", () => ({ default: () => ({}) }))
mock.module("@gitlab/opencode-gitlab-auth", () => ({ default: () => ({}) }))

import { tmpdir } from "../fixture/fixture"
import { WithInstance } from "../../src/project/with-instance"
import { ModelCache } from "../../src/provider/model-cache"
import { AppRuntime } from "../../src/effect/app-runtime"

const clear = (id: string) => AppRuntime.runPromise(ModelCache.Service.use((cache) => cache.clear(id)))
const fetch = (id: string) => AppRuntime.runPromise(ModelCache.Service.use((cache) => cache.fetch(id)))
const failed = () => AppRuntime.runPromise(ModelCache.Service.use((cache) => cache.failedProviders()))
const failure = (id: string) => AppRuntime.runPromise(ModelCache.Service.use((cache) => cache.getFailure(id)))

const CONFIG = JSON.stringify({ $schema: "https://app.kilo.ai/config.json" })

async function withInstance<T>(fn: () => Promise<T>): Promise<T> {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "kilo.json"), CONFIG)
    },
  })
  return WithInstance.provide({ directory: tmp.path, fn })
}

beforeEach(() => {
  stubbedError = undefined
})

test("failedProviders returns empty array when no fetch has occurred", async () => {
  await clear("kilo")
  expect(await failed()).not.toContain("kilo")
})

test("getFailure returns undefined when fetch succeeds", async () => {
  stubbedResult = {
    models: {
      "test/model": {
        id: "test/model",
        name: "Test",
        cost: { input: 1, output: 2 },
        limit: { context: 128000, output: 4096 },
      },
    },
  }
  await clear("kilo")
  await withInstance(() => fetch("kilo"))
  expect(await failure("kilo")).toBeUndefined()
  expect(await failed()).not.toContain("kilo")
})

test("failedProviders includes provider after auth error", async () => {
  stubbedResult = { models: {}, error: { kind: "unauthorized", status: 401 } }
  await clear("kilo")
  await withInstance(() => fetch("kilo"))
  expect(await failed()).toContain("kilo")
  expect(await failure("kilo")).toMatchObject({ kind: "unauthorized", status: 401 })
})

test("gateway rejection remains recoverable through the Effect error channel", async () => {
  stubbedError = new Error("gateway failed")
  await clear("kilo")
  const models = await withInstance(() =>
    AppRuntime.runPromise(
      ModelCache.Service.use((cache) => cache.fetch("kilo").pipe(Effect.catch(() => Effect.succeed({})))),
    ),
  )
  expect(models).toEqual({})
})

test("clear removes failure state", async () => {
  stubbedResult = { models: {}, error: { kind: "network" } }
  await clear("kilo")
  await withInstance(() => fetch("kilo"))
  expect(await failed()).toContain("kilo")

  await clear("kilo")
  expect(await failed()).not.toContain("kilo")
  expect(await failure("kilo")).toBeUndefined()
})

test("failure state is cleared when subsequent fetch succeeds", async () => {
  stubbedResult = { models: {}, error: { kind: "unauthorized", status: 401 } }
  await clear("kilo")
  await withInstance(() => fetch("kilo"))
  expect(await failed()).toContain("kilo")

  stubbedResult = {
    models: {
      "test/model": {
        id: "test/model",
        name: "Test",
        cost: { input: 1, output: 2 },
        limit: { context: 128000, output: 4096 },
      },
    },
  }
  await clear("kilo")
  await withInstance(() => fetch("kilo"))
  expect(await failed()).not.toContain("kilo")
  expect(await failure("kilo")).toBeUndefined()
})
