import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { mkdir, rm, utimes, writeFile } from "fs/promises"
import path from "path"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import { Hash } from "@opencode-ai/core/util/hash"
import { ModelsDev } from "../../src/provider/models"
import { Provider } from "../../src/provider/provider"
import { ProviderID } from "../../src/provider/schema"
import { it } from "../lib/effect"

const model = (id: string, name: string): ModelsDev.Model => ({
  id,
  name,
  release_date: "2026-06-01",
  attachment: false,
  reasoning: false,
  temperature: true,
  tool_call: true,
  limit: { context: 128000, output: 8192 },
})

const initial: Record<string, ModelsDev.Provider> = {
  acme: {
    id: "acme",
    name: "Acme",
    env: ["ACME_API_KEY"],
    npm: "@ai-sdk/openai-compatible",
    api: "https://api.acme.test/v1",
    models: {
      "acme-1": model("acme-1", "Acme One"),
    },
  },
}

const refreshed: Record<string, ModelsDev.Provider> = {
  acme: {
    ...initial.acme,
    models: {
      ...initial.acme.models,
      "acme-2": model("acme-2", "Acme Two"),
    },
  },
}

it.instance(
  "connected providers use refreshed models without instance disposal",
  Effect.gen(function* () {
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          port: 0,
          fetch(request) {
            if (new URL(request.url).pathname !== "/api.json") return new Response("not found", { status: 404 })
            return Response.json(refreshed)
          },
        }),
      ),
      (server) => Effect.sync(() => server.stop(true)),
    )
    const source = `http://127.0.0.1:${server.port}`
    const file = path.join(Global.Path.cache, `models-${Hash.fast(source)}.json`)
    const flags = {
      source: Flag.KILO_MODELS_URL,
      path: Flag.KILO_MODELS_PATH,
      disabled: Flag.KILO_DISABLE_MODELS_FETCH,
      key: process.env.ACME_API_KEY,
    }

    yield* Effect.acquireUseRelease(
      Effect.promise(async () => {
        Flag.KILO_MODELS_URL = source
        Flag.KILO_MODELS_PATH = undefined
        Flag.KILO_DISABLE_MODELS_FETCH = true
        process.env.ACME_API_KEY = "test-key"
        await mkdir(Global.Path.cache, { recursive: true })
        await writeFile(file, JSON.stringify(initial))
        const stale = new Date(Date.now() - 10 * 60 * 1000)
        await utimes(file, stale, stale)
      }),
      () =>
        Effect.gen(function* () {
          const models = yield* ModelsDev.Service
          const provider = yield* Provider.Service
          const before = yield* provider.list()
          expect(before[ProviderID.make("acme")]?.models["acme-1"]).toBeDefined()
          expect(before[ProviderID.make("acme")]?.models["acme-2"]).toBeUndefined()

          yield* models.refresh()

          const after = yield* provider.list()
          expect(after[ProviderID.make("acme")]?.models["acme-2"]).toBeDefined()
        }).pipe(Effect.provide(Layer.merge(ModelsDev.defaultLayer, Provider.defaultLayer))),
      () =>
        Effect.promise(async () => {
          Flag.KILO_MODELS_URL = flags.source
          Flag.KILO_MODELS_PATH = flags.path
          Flag.KILO_DISABLE_MODELS_FETCH = flags.disabled
          if (flags.key === undefined) delete process.env.ACME_API_KEY
          else process.env.ACME_API_KEY = flags.key
          await rm(file, { force: true })
        }),
    )
  }),
  { config: { disabled_providers: ["kilo", "apertis"] } },
)
