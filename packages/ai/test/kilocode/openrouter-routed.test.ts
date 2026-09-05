import { describe, expect } from "bun:test"
import { Effect, Schema, Stream } from "effect"
import { LLM, LLMEvent } from "../../src/index.js"
import { LLMClient, compileRequest } from "../../src/route/client.js"
import { KiloRoutedOpenRouter } from "../../src/kilocode/openrouter-routed.js"
import { it } from "../lib/effect.js"
import { dynamicResponse } from "../lib/http.js"

describe("Kilo routed OpenRouter", () => {
  it.effect("normalizes source reasoningEffort to the OpenRouter reasoning option", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: KiloRoutedOpenRouter.model("kilo-auto/free", {
            apiKey: "test-key",
            models: ["openai/gpt-5.2"],
            reasoningEffort: "high",
          }),
          prompt: "Route this request.",
        }),
      )

      expect(prepared.body).toMatchObject({
        model: "kilo-auto/free",
        models: ["openai/gpt-5.2"],
        reasoning: { effort: "high" },
        usage: { include: true },
      })
      expect(prepared.body).not.toHaveProperty("reasoningEffort")
    }),
  )

  it.effect("keeps credential account metadata out of the compiled and wire request bodies", () =>
    Effect.gen(function* () {
      // Core's model-resolver merges credential metadata into the resolved settings and, for key
      // credentials, into the body overlay before calling model(). Simulate that merged input the
      // same way Core produces it: profile fields, server/organizationID, and token material in
      // both places, alongside deliberate routing/BYOK/reasoning configuration.
      const account = {
        server: "https://kilo.internal",
        organizationID: "org-secret",
        organizationName: "Secret Org",
        email: "user@example.test",
        name: "Account Holder",
        organizations: [{ id: "org-secret", name: "Secret Org", role: "owner" }],
        selectedOrganizationId: "org-secret",
        hasPersonalAccount: true,
        user: { email: "user@example.test", name: "Account Holder" },
        token: "secret-token",
        access: "secret-access",
        refresh: "secret-refresh",
      }
      const request = LLM.request({
        model: KiloRoutedOpenRouter.model("kilo-auto/free", {
          apiKey: "test-key",
          ...account,
          models: ["openai/gpt-5.2"],
          provider: { order: ["together"], allow_fallbacks: false },
          reasoningEffort: "high",
          api_keys: { together: "byok-key" },
          body: {
            ...account,
            include_usage: true,
          },
        }),
        prompt: "Route this request.",
      })
      const prepared = yield* compileRequest(request)

      // Deliberate OpenRouter options survive; account metadata never reaches the compiled body.
      expect(prepared.body).toMatchObject({
        model: "kilo-auto/free",
        models: ["openai/gpt-5.2"],
        provider: { order: ["together"], allow_fallbacks: false },
        reasoning: { effort: "high" },
        usage: { include: true },
      })
      for (const key of Object.keys(account)) {
        expect(prepared.body).not.toHaveProperty(key)
      }

      // The http.body overlay applies at transport time, so prove the final wire body as well.
      const sent: string[] = []
      yield* LLMClient.stream(request).pipe(
        Stream.runDrain,
        Effect.provide(
          dynamicResponse((input) => {
            sent.push(input.text)
            return Effect.succeed(
              input.respond(
                'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\ndata: [DONE]\n\n',
              ),
            )
          }),
        ),
      )
      expect(sent).toHaveLength(1)
      const wire = JSON.parse(sent[0])
      expect(wire).toMatchObject({
        model: "kilo-auto/free",
        models: ["openai/gpt-5.2"],
        provider: { order: ["together"], allow_fallbacks: false },
        reasoning: { effort: "high" },
        include_usage: true,
      })
      const serialized = JSON.stringify(wire)
      for (const key of Object.keys(account)) {
        expect(wire).not.toHaveProperty(key)
      }
      for (const leaked of [
        "kilo.internal",
        "org-secret",
        "Secret Org",
        "user@example.test",
        "Account Holder",
        "secret-token",
        "secret-access",
        "secret-refresh",
      ]) {
        expect(serialized).not.toContain(leaked)
      }
      // The credential itself stays in transport headers, not in the body.
      expect(serialized).not.toContain("test-key")
    }),
  )

  it.effect("still forwards an explicit providerOptions overlay unchanged", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: KiloRoutedOpenRouter.model("kilo-auto/free", {
            apiKey: "test-key",
            providerOptions: {
              transforms: ["middle-out"],
              provider: { sort: "price" },
            },
          }),
          prompt: "Route this request.",
        }),
      )

      expect(prepared.body).toMatchObject({
        transforms: ["middle-out"],
        provider: { sort: "price" },
      })
    }),
  )

  it.effect("carries an earlier response model into terminal usage metadata", () =>
    Effect.gen(function* () {
      const request = LLM.request({
        model: KiloRoutedOpenRouter.model("kilo-auto/free", { apiKey: "test-key" }),
        prompt: "Route this request.",
      })
      const decode = Schema.decodeUnknownSync(KiloRoutedOpenRouter.routedProtocol.stream.event)
      const first = decode(
        JSON.stringify({
          model: "provider/actual",
          choices: [{ index: 0, delta: { role: "assistant", content: "Routed" }, finish_reason: null }],
        }),
      )
      const [afterFirst] = yield* KiloRoutedOpenRouter.routedProtocol.stream.step(
        KiloRoutedOpenRouter.routedProtocol.stream.initial(request),
        first,
      )
      const final = decode(
        JSON.stringify({
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      )
      const [afterFinal] = yield* KiloRoutedOpenRouter.routedProtocol.stream.step(afterFirst, final)
      const terminal = yield* KiloRoutedOpenRouter.routedProtocol.stream.onHalt!(afterFinal)
      const stepFinish = terminal.find(LLMEvent.is.stepFinish)

      expect(stepFinish?.providerMetadata).toEqual({
        kilo: {
          prompt_tokens: 1,
          completion_tokens: 1,
          total_tokens: 2,
          routedModelID: "provider/actual",
        },
      })
    }),
  )

  it.effect("does not manufacture a routed model ID from an invalid response value", () =>
    Effect.gen(function* () {
      const request = LLM.request({
        model: KiloRoutedOpenRouter.model("kilo-auto/free", { apiKey: "test-key" }),
        prompt: "Route this request.",
      })
      const decode = Schema.decodeUnknownSync(KiloRoutedOpenRouter.routedProtocol.stream.event)
      const [state] = yield* KiloRoutedOpenRouter.routedProtocol.stream.step(
        KiloRoutedOpenRouter.routedProtocol.stream.initial(request),
        decode(
          JSON.stringify({
            model: "provider/actual\\nnext",
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
        ),
      )
      const terminal = yield* KiloRoutedOpenRouter.routedProtocol.stream.onHalt!(state)
      const stepFinish = terminal.find(LLMEvent.is.stepFinish)

      expect(stepFinish?.providerMetadata).toBeUndefined()
    }),
  )
})
