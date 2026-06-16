import { afterAll, beforeEach, expect } from "bun:test"
import { generateText } from "ai"
import { Effect } from "effect"
import { Provider } from "../../../src/provider/provider"
import { ModelID, ProviderID } from "../../../src/provider/schema"
import { testEffect } from "../../lib/effect"

const requests: unknown[] = []
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    requests.push(await request.json())
    return Response.json({
      id: "response-1",
      created: 0,
      model: "privacy-model",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "ok" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    })
  },
})

beforeEach(() => {
  requests.length = 0
})

afterAll(() => {
  server.stop(true)
})

const it = testEffect(Provider.defaultLayer)

it.instance(
  "enforces deny on the final OpenRouter request body",
  Effect.gen(function* () {
    const provider = yield* Provider.Service
    const model = yield* provider.getModel(ProviderID.make("privacy-openrouter"), ModelID.make("privacy-model"))
    const language = yield* provider.getLanguage(model)

    yield* Effect.promise(() =>
      generateText({
        model: language,
        prompt: "hello",
        providerOptions: {
          openrouter: {
            provider: {
              order: ["Anthropic"],
              data_collection: "allow",
            },
          },
        },
      }),
    )

    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      provider: {
        order: ["Anthropic"],
        data_collection: "deny",
      },
    })
  }),
  {
    config: {
      hide_prompt_training_models: true,
      provider: {
        "privacy-openrouter": {
          name: "Privacy OpenRouter",
          npm: "@openrouter/ai-sdk-provider",
          api: `http://127.0.0.1:${server.port}`,
          models: {
            "privacy-model": {
              name: "Privacy Model",
              tool_call: true,
              limit: { context: 128_000, output: 4_096 },
            },
          },
          options: { apiKey: "test-key" },
        },
      },
    },
  },
)
