import { afterAll, beforeAll, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { mkdir, readFile, rm, writeFile } from "fs/promises"
import path from "path"
import * as TestConsole from "effect/testing/TestConsole"
import { it } from "../lib/effect"

const ORIGINAL_MODELS_PATH = Flag.KILO_MODELS_PATH
const ORIGINAL_DISABLE_FETCH = Flag.KILO_DISABLE_MODELS_FETCH
const cache = Global.Path.cache
const log = Global.Path.log
const root = path.join(Global.Path.tmp, `models-logger-${process.pid}-${Math.random().toString(36).slice(2)}`)
const logs = path.join(root, "log")

beforeAll(async () => {
  Flag.KILO_MODELS_PATH = undefined
  Flag.KILO_DISABLE_MODELS_FETCH = true
  Global.Path.cache = root
  Global.Path.log = logs
  await mkdir(logs, { recursive: true })
  await writeFile(path.join(root, "models.json"), "{}")
})

afterAll(async () => {
  Flag.KILO_MODELS_PATH = ORIGINAL_MODELS_PATH
  Flag.KILO_DISABLE_MODELS_FETCH = ORIGINAL_DISABLE_FETCH
  Global.Path.cache = cache
  Global.Path.log = log
  await rm(root, { recursive: true, force: true })
})

const client = HttpClient.make((request) =>
  Effect.succeed(HttpClientResponse.fromWeb(request, new Response("boom", { status: 500 }))),
)

const layer = Layer.fresh(
  AppNodeBuilder.build(ModelsDev.node, [[LayerNodePlatform.httpClient, Layer.succeed(HttpClient.HttpClient, client)]]),
)

async function logged() {
  const file = path.join(logs, "opencode.log")
  for (let i = 0; i < 50; i++) {
    const text = await readFile(file, "utf8").catch(() => "")
    if (text.includes("Failed to fetch models.dev")) return text
    await Bun.sleep(10)
  }
  return await readFile(file, "utf8").catch(() => "")
}

describe("ModelsDev catalog refresh logging", () => {
  it.live("failed refresh logs to file without Effect defaultLogger", () =>
    Effect.gen(function* () {
      yield* ModelsDev.Service.use((s) => s.refresh(true)).pipe(Effect.provide(layer))
      const lines = yield* TestConsole.logLines
      expect(lines.join("\n")).not.toContain("Failed to fetch models.dev")
      expect(yield* Effect.promise(logged)).toContain("Failed to fetch models.dev")
    }),
  )
})
