import { expect } from "bun:test"
import { Effect } from "effect"
import { LLM } from "../../src"
import * as OpenAI from "../../src/providers/openai"
import * as OpenAIResponses from "../../src/protocols/openai-responses"
import { LLMClient } from "../../src/route"
import { it } from "../lib/effect"

for (const summary of ["auto", "concise", "detailed"] as const) {
  it.effect(`serializes the ${summary} OpenAI reasoning summary mode`, () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare<OpenAIResponses.OpenAIResponsesBody>(
        LLM.request({
          model: OpenAI.configure({ baseURL: "https://api.openai.test/v1/", apiKey: "test" }).model("gpt-5.6"),
          prompt: "think",
          providerOptions: { openai: { reasoningEffort: "high", reasoningSummary: summary } },
        }),
      )

      expect(prepared.body.reasoning).toEqual({ effort: "high", summary })
    }),
  )
}
