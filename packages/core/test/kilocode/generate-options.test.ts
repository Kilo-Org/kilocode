import { expect } from "bun:test"
import { LanguageModel } from "@opencode/ai/effect"
import { OpenAIChat } from "@opencode/ai/protocols"
import { RequestExecutor } from "@opencode/ai/route"
import { TestLLM } from "@opencode/ai/testing"
import { AISDK } from "@opencode/core/aisdk"
import { Generate } from "@opencode/core/generate"
import { Integration } from "@opencode/core/integration"
import { ModelResolver } from "@opencode/core/model-resolver"
import { ID, Info, Model, Ref } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { Npm } from "@opencode/util/npm"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"

const selected = Info.make({
  ...Info.default(Provider.ID.make("test-provider"), ID.make("gemini")),
  package: Provider.aisdk("@ai-sdk/perplexity"),
})
const runtime = LanguageModel.make({ id: "gemini", provider: "test-provider", route: OpenAIChat.route })
const reference = Ref.make({ providerID: selected.providerID, id: selected.id })

const providers = Layer.mock(Provider.Service, {
  get: () => Effect.undefined,
})
const models = Layer.mock(Model.Service, {
  get: () => Effect.succeed(selected),
})
const integrations = Layer.mock(Integration.Service, {
  revision: () => 0,
  connection: {
    active: () => Effect.undefined,
    resolve: () => Effect.die("unused"),
    key: () => Effect.die("unused"),
    external: () => Effect.die("unused"),
    activate: () => Effect.die("unused"),
    update: () => Effect.die("unused"),
    remove: () => Effect.die("unused"),
    status: () => Effect.die("unused"),
  },
  oauth: {
    connect: () => Effect.die("unused"),
    status: () => Effect.die("unused"),
    complete: () => Effect.die("unused"),
    cancel: () => Effect.die("unused"),
  },
  command: {
    connect: () => Effect.die("unused"),
    status: () => Effect.die("unused"),
    cancel: () => Effect.die("unused"),
  },
})
const npm = Layer.mock(Npm.Service, {
  add: () => Effect.die("unused"),
  which: () => Effect.die("unused"),
})
const aisdk = Layer.mock(AISDK.Service, {
  hook: {
    sdk: () => Effect.die("unused"),
    language: () => Effect.die("unused"),
  },
  model: () => Effect.succeed(runtime),
})
const resolver = ModelResolver.layer.pipe(Layer.provide(Layer.mergeAll(providers, models, integrations, npm, aisdk)))
const client = TestLLM.testLayer({ fallback: TestLLM.text("OK", "generate") })
const it = testEffect(
  Generate.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(resolver, client, Layer.mergeAll(models, RequestExecutor.fetchLayer))),
  ),
)

it.effect("forwards the optional system prompt and generation settings", () =>
  Effect.gen(function* () {
    const generate = yield* Generate.Service
    const llm = yield* TestLLM.Test
    yield* generate.text({
      prompt: "User messages, oldest to newest:\n\n1. Fix auth",
      system: "Generate a Git branch name",
      generation: { temperature: 0.1 },
      model: reference,
    })

    const requests = yield* llm.requests()
    expect(requests).toHaveLength(1)
    expect(requests[0]!.system).toEqual([{ type: "text", text: "Generate a Git branch name" }])
    expect(JSON.stringify(requests[0]!.messages)).toContain("Fix auth")
    expect(requests[0]!.temperature).toBe(0.1)
  }),
)
