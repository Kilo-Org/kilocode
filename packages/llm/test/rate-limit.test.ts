import { describe, expect } from "bun:test"
import { Effect, Fiber, Ref } from "effect"
import { TestClock } from "effect/testing"
import { HttpClientRequest } from "effect/unstable/http"
import { LLM, LLMClient } from "../src"
import * as OpenAIChat from "../src/protocols/openai-chat"
import { dynamicResponse } from "./lib/http"
import { deltaChunk } from "./lib/openai-chunks"
import { sseEvents } from "./lib/sse"
import { it } from "./lib/effect"

const sseFinish = sseEvents(deltaChunk({}, "stop"))

describe("rate limiter", () => {
  it.effect("delays when RPM limit is exceeded",
    Effect.gen(function* () {
      const route = OpenAIChat.route.with({ endpoint: { baseURL: "https://api.rpm-limit.test/v1" } })
      const model = route.model({ id: "gpt-4o-mini" })
      const request = LLM.request({ model, prompt: "Say hello.", rateLimit: { rpm: 2 } })
      const response1 = yield* LLMClient.generate(request).pipe(
        Effect.provide(dynamicResponse((input) => Effect.sync(() => input.respond(sseFinish)))),
      )
      expect(response1).toBeDefined()

      const response2 = yield* LLMClient.generate(request).pipe(
        Effect.provide(dynamicResponse((input) => Effect.sync(() => input.respond(sseFinish)))),
      )
      expect(response2).toBeDefined()

      const fiber = yield* Effect.forkChild(
        LLMClient.generate(request).pipe(
          Effect.provide(dynamicResponse((input) => Effect.sync(() => input.respond(sseFinish)))),
        ),
      )
      yield* TestClock.adjust("61 seconds")
      const response3 = yield* Fiber.join(fiber)
      expect(response3).toBeDefined()
    }),
  )

  it.effect("delays after RPM window fills",
    Effect.gen(function* () {
      const route = OpenAIChat.route.with({ endpoint: { baseURL: "https://api.rpm-window.test/v1" } })
      const model = route.model({ id: "gpt-4o-mini" })
      const request = LLM.request({ model, prompt: "Say hello.", rateLimit: { rpm: 1 } })
      const response1 = yield* LLMClient.generate(request).pipe(
        Effect.provide(dynamicResponse((input) => Effect.sync(() => input.respond(sseFinish)))),
      )
      expect(response1).toBeDefined()

      const fiber = yield* Effect.forkChild(
        LLMClient.generate(request).pipe(
          Effect.provide(dynamicResponse((input) => Effect.sync(() => input.respond(sseFinish)))),
        ),
      )
      yield* TestClock.adjust("61 seconds")
      const response2 = yield* Fiber.join(fiber)
      expect(response2).toBeDefined()
    }),
  )

  it.effect("no delay when under RPM limit",
    Effect.gen(function* () {
      const route = OpenAIChat.route.with({ endpoint: { baseURL: "https://api.under-rpm.test/v1" } })
      const model = route.model({ id: "gpt-4o-mini" })
      const request = LLM.request({ model, prompt: "Say hello.", rateLimit: { rpm: 100 } })
      const response = yield* LLMClient.generate(request).pipe(
        Effect.provide(dynamicResponse((input) => Effect.sync(() => input.respond(sseFinish)))),
      )
      expect(response).toBeDefined()
    }),
  )

  it.effect("delays when RPS limit is exceeded",
    Effect.gen(function* () {
      const route = OpenAIChat.route.with({ endpoint: { baseURL: "https://api.rps-limit.test/v1" } })
      const model = route.model({ id: "gpt-4o-mini" })
      const request = LLM.request({ model, prompt: "Say hello.", rateLimit: { rps: 1 } })
      const response1 = yield* LLMClient.generate(request).pipe(
        Effect.provide(dynamicResponse((input) => Effect.sync(() => input.respond(sseFinish)))),
      )
      expect(response1).toBeDefined()

      const fiber = yield* Effect.forkChild(
        LLMClient.generate(request).pipe(
          Effect.provide(dynamicResponse((input) => Effect.sync(() => input.respond(sseFinish)))),
        ),
      )
      yield* TestClock.adjust("2 seconds")
      const response2 = yield* Fiber.join(fiber)
      expect(response2).toBeDefined()
    }),
  )

  it.effect("no delay when under RPS limit",
    Effect.gen(function* () {
      const route = OpenAIChat.route.with({ endpoint: { baseURL: "https://api.under-rps.test/v1" } })
      const model = route.model({ id: "gpt-4o-mini" })
      const request = LLM.request({ model, prompt: "Say hello.", rateLimit: { rps: 100 } })
      const response = yield* LLMClient.generate(request).pipe(
        Effect.provide(dynamicResponse((input) => Effect.sync(() => input.respond(sseFinish)))),
      )
      expect(response).toBeDefined()
    }),
  )

  it.effect("RPM and RPS limits work independently",
    Effect.gen(function* () {
      const route = OpenAIChat.route.with({ endpoint: { baseURL: "https://api.independent.test/v1" } })
      const model = route.model({ id: "gpt-4o-mini" })
      const request = LLM.request({ model, prompt: "Say hello.", rateLimit: { rpm: 1, rps: 100 } })
      const response1 = yield* LLMClient.generate(request).pipe(
        Effect.provide(dynamicResponse((input) => Effect.sync(() => input.respond(sseFinish)))),
      )
      expect(response1).toBeDefined()

      const fiber = yield* Effect.forkChild(
        LLMClient.generate(request).pipe(
          Effect.provide(dynamicResponse((input) => Effect.sync(() => input.respond(sseFinish)))),
        ),
      )
      yield* TestClock.adjust("61 seconds")
      const response2 = yield* Fiber.join(fiber)
      expect(response2).toBeDefined()
    }),
  )

  it.effect("respects request rateLimit over model defaults",
    Effect.gen(function* () {
      const route = OpenAIChat.route.with({ endpoint: { baseURL: "https://api.override.test/v1" } })
      const model = route.model({
        id: "gpt-4o-mini",
        defaults: { rateLimit: { rpm: 100 } },
      })
      const request = LLM.request({ model, prompt: "Say hello.", rateLimit: { rpm: 1 } })
      const response1 = yield* LLMClient.generate(request).pipe(
        Effect.provide(dynamicResponse((input) => Effect.sync(() => input.respond(sseFinish)))),
      )
      expect(response1).toBeDefined()

      const fiber = yield* Effect.forkChild(
        LLMClient.generate(request).pipe(
          Effect.provide(dynamicResponse((input) => Effect.sync(() => input.respond(sseFinish)))),
        ),
      )
      yield* TestClock.adjust("61 seconds")
      const response2 = yield* Fiber.join(fiber)
      expect(response2).toBeDefined()
    }),
  )

  it.effect("no rate limit headers when rateLimit is absent",
    Effect.gen(function* () {
      const receivedHeaders = yield* Ref.make<Record<string, string>>({})
      const route = OpenAIChat.route.with({ endpoint: { baseURL: "https://api.no-headers.test/v1" } })
      const model = route.model({ id: "gpt-4o-mini" })
      const request = LLM.request({ model, prompt: "Say hello." })
      yield* LLMClient.generate(request).pipe(
        Effect.provide(
          dynamicResponse((input) =>
            Effect.gen(function* () {
              const web = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
              const hdrs: Record<string, string> = {}
              for (const [k, v] of web.headers.entries()) {
                hdrs[k] = v
              }
              yield* Ref.set(receivedHeaders, hdrs)
              return input.respond(sseFinish)
            }),
          ),
        ),
      )

      const headers = yield* Ref.get(receivedHeaders)
      expect(headers["x-kilo-ratelimit-rpm"]).toBeUndefined()
      expect(headers["x-kilo-ratelimit-rps"]).toBeUndefined()
    }),
  )

  it.effect("adds rate limit headers when rateLimit is present",
    Effect.gen(function* () {
      const receivedHeaders = yield* Ref.make<Record<string, string>>({})
      const route = OpenAIChat.route.with({ endpoint: { baseURL: "https://api.headers.test/v1" } })
      const model = route.model({ id: "gpt-4o-mini" })
      const request = LLM.request({ model, prompt: "Say hello.", rateLimit: { rpm: 10, rps: 2 } })
      yield* LLMClient.generate(request).pipe(
        Effect.provide(
          dynamicResponse((input) =>
            Effect.gen(function* () {
              const web = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
              const hdrs: Record<string, string> = {}
              for (const [k, v] of web.headers.entries()) {
                hdrs[k] = v
              }
              yield* Ref.set(receivedHeaders, hdrs)
              return input.respond(sseFinish)
            }),
          ),
        ),
      )

      const headers = yield* Ref.get(receivedHeaders)
      expect(headers["x-kilo-ratelimit-rpm"]).toBe("10")
      expect(headers["x-kilo-ratelimit-rps"]).toBe("2")
    }),
  )

  it.effect("isolates rate limiters by provider hostname",
    Effect.gen(function* () {
      const routeA = OpenAIChat.route.with({ endpoint: { baseURL: "https://api.alpha.test/v1" } })
      const routeB = OpenAIChat.route.with({ endpoint: { baseURL: "https://api.beta.test/v1" } })
      const modelA = routeA.model({ id: "gpt-4o-mini" })
      const modelB = routeB.model({ id: "gpt-4o-mini" })

      const reqA = LLM.request({ model: modelA, prompt: "Say hello.", rateLimit: { rps: 1 } })
      const reqB = LLM.request({ model: modelB, prompt: "Say hello.", rateLimit: { rps: 1 } })

      const [resA, resB] = yield* Effect.all([
        LLMClient.generate(reqA).pipe(Effect.provide(dynamicResponse((input) => Effect.sync(() => input.respond(sseFinish))))),
        LLMClient.generate(reqB).pipe(Effect.provide(dynamicResponse((input) => Effect.sync(() => input.respond(sseFinish))))),
      ])
      expect(resA).toBeDefined()
      expect(resB).toBeDefined()
    }),
  )
})