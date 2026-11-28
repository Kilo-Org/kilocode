import { afterEach, expect } from "bun:test"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Effect, Layer } from "effect"
import { Auth } from "../../../src/auth"
import { ModelCache } from "../../../src/provider/model-cache"
import { Server } from "../../../src/server/server"
import { disposeAllInstances, tmpdir } from "../../fixture/fixture"
import { resetDatabase } from "../../fixture/db"
import { testEffectShared } from "../../lib/effect"

const it = testEffectShared(Layer.merge(AppNodeBuilder.build(ModelCache.node), AppNodeBuilder.build(Auth.node)))

function request(path: string, dir: string) {
  return Effect.promise(async () => {
    const result = await Server.Default().app.request(path, { headers: { "x-kilo-directory": dir } })
    const text = await result.text()
    return { status: result.status, text, body: JSON.parse(text) as unknown }
  })
}

it.live("issue #15790: config providers expose bridged attachment and modality capabilities", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireRelease(
      Effect.promise(() =>
        tmpdir({
          config: {
            formatter: false,
            lsp: false,
            provider: {
              "issue-15790-http": {
                npm: "@ai-sdk/openai-compatible",
                models: {
                  "vision-model": {
                    name: "vision-model",
                    attachment: true,
                    modalities: { input: ["text", "image"], output: ["text"] },
                  },
                },
              },
            },
          },
        }),
      ),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    )

    const response = yield* request("/config/providers", tmp.path)
    expect(response.status).toBe(200)
    const providers = (response.body as { providers?: Array<Record<string, unknown>> }).providers
    expect(Array.isArray(providers)).toBe(true)
    const provider = providers?.find((item) => item.id === "issue-15790-http")
    expect(provider).toBeDefined()
    const models = provider?.models as Record<string, Record<string, unknown>>
    const capabilities = models["vision-model"].capabilities as Record<string, unknown>
    expect(capabilities.attachment).toBe(true)
    expect((capabilities.input as Record<string, unknown>).image).toBe(true)
  }),
)

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})
