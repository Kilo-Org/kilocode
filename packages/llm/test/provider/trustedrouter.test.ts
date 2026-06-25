import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM } from "../../src"
import { LLMClient } from "../../src/route"
import * as TrustedRouter from "../../src/providers/trustedrouter"
import { it } from "../lib/effect"

describe("TrustedRouter", () => {
  it.effect("prepares TrustedRouter models through the OpenAI-compatible Chat route", () =>
    Effect.gen(function* () {
      const model = TrustedRouter.model("trustedrouter/auto", { apiKey: "test-key" })

      expect(model).toMatchObject({
        id: "trustedrouter/auto",
        provider: "trustedrouter",
        route: "trustedrouter",
        baseURL: "https://api.trustedrouter.com/v1",
        apiKey: "test-key",
      })

      const prepared = yield* LLMClient.prepare(LLM.request({ model, prompt: "Say hello." }))

      expect(prepared.route).toBe("trustedrouter")
      expect(prepared.body).toMatchObject({
        model: "trustedrouter/auto",
        messages: [{ role: "user", content: "Say hello." }],
        stream: true,
      })
    }),
  )

  it.effect("applies TrustedRouter payload options from the model helper", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare(
        LLM.request({
          model: TrustedRouter.model("trustedrouter/zdr", {
            providerOptions: {
              trustedrouter: {
                usage: true,
                reasoning: { effort: "high" },
                promptCacheKey: "session_123",
              },
            },
          }),
          prompt: "Think briefly.",
        }),
      )

      expect(prepared.body).toMatchObject({
        usage: { include: true },
        reasoning: { effort: "high" },
        prompt_cache_key: "session_123",
      })
    }),
  )
})
