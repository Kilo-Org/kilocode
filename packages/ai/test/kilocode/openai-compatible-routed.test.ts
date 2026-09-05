import { describe, expect } from "bun:test"
import { Effect, Schema, Stream } from "effect"
import { LLM, LLMEvent } from "../../src/index.js"
import { LLMClient, compileRequest } from "../../src/route/client.js"
import { KiloRoutedOpenAICompatible } from "../../src/kilocode/openai-compatible-routed.js"
import { it } from "../lib/effect.js"
import { dynamicResponse } from "../lib/http.js"

const baseURL = "http://127.0.0.1:8000/api/gateway"

describe("Kilo routed OpenAI-compatible", () => {
  it.effect("lowers source reasoningEffort to the chat reasoning_effort body field", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: KiloRoutedOpenAICompatible.model("kilo-auto/compatible", {
            apiKey: "test-key",
            baseURL,
            reasoningEffort: "high",
          }),
          prompt: "Route this request.",
        }),
      )

      expect(prepared.body).toMatchObject({
        model: "kilo-auto/compatible",
        reasoning_effort: "high",
      })
      expect(prepared.body).not.toHaveProperty("reasoningEffort")
    }),
  )

  it.effect("keeps credential account metadata out of the compiled and wire request bodies", () =>
    Effect.gen(function* () {
      // Core's model-resolver merges credential metadata into the resolved settings and, for key
      // credentials, into the body overlay before calling model(). Simulate that merged input the
      // same way Core produces it: profile fields, server/organizationID, and token material in
      // both places, alongside deliberate variant reasoning configuration.
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
        model: KiloRoutedOpenAICompatible.model("kilo-auto/compatible", {
          apiKey: "test-key",
          baseURL,
          ...account,
          reasoningEffort: "high",
          body: {
            ...account,
            include_usage: true,
          },
        }),
        prompt: "Route this request.",
      })
      const prepared = yield* compileRequest(request)

      // Deliberate compatible options survive; account metadata never reaches the compiled body.
      expect(prepared.body).toMatchObject({
        model: "kilo-auto/compatible",
        reasoning_effort: "high",
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
        model: "kilo-auto/compatible",
        reasoning_effort: "high",
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
          model: KiloRoutedOpenAICompatible.model("kilo-auto/compatible", {
            apiKey: "test-key",
            baseURL,
            providerOptions: {
              store: true,
              textVerbosity: "low",
            },
          }),
          prompt: "Route this request.",
        }),
      )

      expect(prepared.body).toMatchObject({
        store: true,
      })
    }),
  )

  it.effect("carries an earlier response model into terminal usage metadata", () =>
    Effect.gen(function* () {
      const request = LLM.request({
        model: KiloRoutedOpenAICompatible.model("kilo-auto/compatible", { apiKey: "test-key", baseURL }),
        prompt: "Route this request.",
      })
      const decode = Schema.decodeUnknownSync(KiloRoutedOpenAICompatible.routedProtocol.stream.event)
      const first = decode(
        JSON.stringify({
          model: "provider/compatible-actual",
          choices: [{ index: 0, delta: { role: "assistant", content: "Routed" }, finish_reason: null }],
        }),
      )
      const [afterFirst] = yield* KiloRoutedOpenAICompatible.routedProtocol.stream.step(
        KiloRoutedOpenAICompatible.routedProtocol.stream.initial(request),
        first,
      )
      const final = decode(
        JSON.stringify({
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      )
      const [afterFinal] = yield* KiloRoutedOpenAICompatible.routedProtocol.stream.step(afterFirst, final)
      const terminal = yield* KiloRoutedOpenAICompatible.routedProtocol.stream.onHalt!(afterFinal)
      const stepFinish = terminal.find(LLMEvent.is.stepFinish)

      expect(stepFinish?.providerMetadata).toEqual({
        kilo: {
          prompt_tokens: 1,
          completion_tokens: 1,
          total_tokens: 2,
          routedModelID: "provider/compatible-actual",
        },
      })
    }),
  )

  it.effect("does not manufacture a routed model ID from an invalid response value", () =>
    Effect.gen(function* () {
      const request = LLM.request({
        model: KiloRoutedOpenAICompatible.model("kilo-auto/compatible", { apiKey: "test-key", baseURL }),
        prompt: "Route this request.",
      })
      const decode = Schema.decodeUnknownSync(KiloRoutedOpenAICompatible.routedProtocol.stream.event)
      const [state] = yield* KiloRoutedOpenAICompatible.routedProtocol.stream.step(
        KiloRoutedOpenAICompatible.routedProtocol.stream.initial(request),
        decode(
          JSON.stringify({
            model: "provider/actual\\nnext",
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
        ),
      )
      const terminal = yield* KiloRoutedOpenAICompatible.routedProtocol.stream.onHalt!(state)
      const stepFinish = terminal.find(LLMEvent.is.stepFinish)

      expect(stepFinish?.providerMetadata).toBeUndefined()
    }),
  )
})
