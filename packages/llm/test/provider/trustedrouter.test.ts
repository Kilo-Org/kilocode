import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM } from "../../src"
import { LLMClient } from "../../src/route"
import * as TrustedRouter from "../../src/providers/trustedrouter"
import { it } from "../lib/effect"

describe("TrustedRouter", () => {
  it.effect("prepares TrustedRouter models through the OpenAI-compatible Chat route", () =>
    Effect.gen(function* () {
      const model = TrustedRouter.configure({ apiKey: "test-key" }).model("anthropic/claude-opus-4.8")

      expect(model).toMatchObject({
        id: "anthropic/claude-opus-4.8",
        provider: "trustedrouter",
        route: { id: "trustedrouter" },
      })
      expect(model.route.endpoint.baseURL).toBe("https://api.trustedrouter.com/v1")

      const prepared = yield* LLMClient.prepare(LLM.request({ model, prompt: "Say hello." }))

      expect(prepared.route).toBe("trustedrouter")
      expect(prepared.body).toMatchObject({
        model: "anthropic/claude-opus-4.8",
        messages: [{ role: "user", content: "Say hello." }],
        stream: true,
      })
    }),
  )

  it.effect("re-qualifies bare routing aliases with the trustedrouter/ namespace", () =>
    Effect.gen(function* () {
      // Kilo's parseModel("trustedrouter/auto") hands the provider the bare id
      // "auto"; the upstream API expects "trustedrouter/auto".
      const model = TrustedRouter.configure({ apiKey: "test-key" }).model("auto")

      expect(model).toMatchObject({ id: "trustedrouter/auto" })

      const prepared = yield* LLMClient.prepare(LLM.request({ model, prompt: "Say hello." }))

      expect(prepared.body).toMatchObject({ model: "trustedrouter/auto" })
    }),
  )

  it.effect("applies TrustedRouter payload options from the model helper", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare(
        LLM.request({
          model: TrustedRouter.configure({
            apiKey: "test-key",
            providerOptions: {
              trustedrouter: {
                usage: true,
                reasoning: { effort: "high" },
                promptCacheKey: "session_123",
              },
            },
          }).model("zdr"),
          prompt: "Think briefly.",
        }),
      )

      expect(prepared.body).toMatchObject({
        model: "trustedrouter/zdr",
        usage: { include: true },
        reasoning: { effort: "high" },
        prompt_cache_key: "session_123",
      })
    }),
  )
})
