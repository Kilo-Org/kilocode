import { afterEach, expect } from "bun:test"
import { Effect } from "effect"
import { Server } from "../../../src/server/server"
import * as Log from "@opencode-ai/core/util/log"
import { disposeAllInstances, tmpdir } from "../../fixture/fixture"
import { resetDatabase } from "../../fixture/db"
import { it } from "../../lib/effect"

void Log.init({ print: false })

const response = {
  data: [
    {
      id: "test/training",
      name: "Training",
      context_length: 128000,
      max_completion_tokens: 4096,
      architecture: { input_modalities: ["text"], output_modalities: ["text"] },
      supported_parameters: ["tools", "temperature"],
      mayTrainOnYourPrompts: true,
    },
    {
      id: "test/private",
      name: "Private",
      context_length: 128000,
      max_completion_tokens: 4096,
      architecture: { input_modalities: ["text"], output_modalities: ["text"] },
      supported_parameters: ["tools", "temperature"],
      mayTrainOnYourPrompts: false,
    },
  ],
}

function record(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}

function models(input: unknown, key: "all" | "providers") {
  if (!record(input) || !Array.isArray(input[key])) return []
  const kilo = input[key].find((provider) => record(provider) && provider.id === "kilo")
  if (!record(kilo) || !record(kilo.models)) return []
  return Object.keys(kilo.models)
}

function request(path: string, dir: string) {
  return Effect.promise(async () => {
    const result = await Server.Default().app.request(path, { headers: { "x-kilo-directory": dir } })
    expect(result.status).toBe(200)
    return result.json()
  })
}

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

it.live(
  "filters prompt-training models from both provider catalogs",
  Effect.gen(function* () {
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          port: 0,
          fetch() {
            return Response.json(response)
          },
        }),
      ),
      (server) => Effect.sync(() => server.stop(true)),
    )
    const baseURL = `http://127.0.0.1:${server.port}`
    const tmp = yield* Effect.acquireRelease(
      Effect.promise(() =>
        tmpdir({
          config: {
            formatter: false,
            lsp: false,
            enabled_providers: ["kilo"],
            hide_prompt_training_models: true,
            provider: { kilo: { options: { baseURL } } },
          },
        }),
      ),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    )
    const key = process.env.KILO_API_KEY
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        process.env.KILO_API_KEY = "test-key"
      }),
      () =>
        Effect.sync(() => {
          if (key === undefined) delete process.env.KILO_API_KEY
          else process.env.KILO_API_KEY = key
        }),
    )

    const all = yield* request("/provider", tmp.path)
    const connected = yield* request("/config/providers", tmp.path)

    expect(models(all, "all")).toEqual(["test/private"])
    expect(models(connected, "providers")).toEqual(["test/private"])
  }),
)
