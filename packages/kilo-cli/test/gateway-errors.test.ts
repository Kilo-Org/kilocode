import { describe, expect } from "bun:test"
import { KiloErrors, KiloStream } from "@kilocode/gateway-core"
import { AIError, LanguageModel, LLM, LLMClient } from "@opencode/ai"
import { Anthropic, OpenAI, OpenRouter } from "@opencode/ai/providers"
import { ModelRetry } from "@opencode/core/model-retry"
import { SessionRunnerRetry } from "@opencode/core/session/runner/retry"
import { toSessionError } from "@opencode/core/session/to-session-error"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { Session } from "@opencode/schema/session"
import { Deferred, Effect, Fiber, Stream } from "effect"
import { TestClock } from "effect/testing"
import { dynamicResponse, truncatedStream } from "../../ai/test/lib/http"
import { sseEvents } from "../../ai/test/lib/sse"
import { it } from "../../core/test/lib/effect"
import { layer } from "../src/gateway-errors"

const settings = { apiKey: "fixture", baseURL: "https://gateway.test/v1" }
const dialects = [
  { name: "OpenRouter", model: OpenRouter.model("fixture", settings) },
  { name: "OpenAI Responses", model: OpenAI.model("gpt-5.5", settings) },
  { name: "Anthropic", model: Anthropic.model("claude-sonnet-4-6", settings) },
].map((dialect) => ({ ...dialect, model: LanguageModel.update(dialect.model, { provider: "kilo" }) }))
const model = dialects[0].model
const request = (selected: LanguageModel = model) => LLM.request({ model: selected, prompt: "Hello" })

// Only transport responses are fixtures. Normalization, parsing, error conversion, and retry policy are real.
const runtime = (response: () => Response, normalize = true) =>
  layer(
    dynamicResponse((input) =>
      Effect.promise(async () => {
        const raw = response()
        const rewritten = !normalize
          ? raw
          : raw.status >= 400
            ? await KiloErrors.rewriteHttpResponse(raw)
            : KiloStream.transformResponse(raw)
        return input.respond(rewritten.body, { status: rewritten.status, headers: rewritten.headers })
      }),
    ),
  )

const response = (body: unknown, status = 200, headers?: Record<string, string>) =>
  status >= 400
    ? Response.json(body, { status, headers })
    : new Response(sseEvents(body), { headers: { "content-type": "text/event-stream", ...headers } })

const decide = (cause: AIError, selected: LanguageModel = model) =>
  Effect.gen(function* () {
    const error = toSessionError(cause)
    const policy = yield* SessionRunnerRetry.policy(Session.ID.make("ses_gateway_error"))
    const decision = yield* policy({
      cause,
      error,
      agent: Agent.ID.make("code"),
      model: Model.Ref.make({ providerID: Provider.ID.make(selected.provider), id: Model.ID.make(selected.id) }),
      retry: SessionRunnerRetry.isRetryable(cause),
      hook: () => Effect.void,
    })
    return { error, decision }
  })

describe("Kilo Gateway native error path", () => {
  for (const dialect of dialects) {
    it.effect(`stops HTTP and SSE sign-in and promotion errors through ${dialect.name}`, () =>
      Effect.gen(function* () {
        for (const entry of [
          { code: "PAID_MODEL_AUTH_REQUIRED", status: 401, message: "sign in" },
          { code: "PROMOTION_MODEL_LIMIT_REACHED", status: 429, message: "sign up" },
        ]) {
          for (const status of [entry.status, 200]) {
            const cause = yield* LLM.stream(request(dialect.model)).pipe(
              Stream.runCollect,
              Effect.flip,
              Effect.provide(runtime(() => response({ error: { code: entry.code, message: "Rejected" } }, status))),
            )
            const result = yield* decide(cause, dialect.model)
            expect(result.decision).toEqual({ retry: false })
            expect(result.error.message).toContain(entry.message)
            expect(result.error.status).toBe(status)
            expect(JSON.parse(result.error.response!.body).error).toMatchObject({ code: entry.code, retryable: false })
            expect(cause.reason.http?.headers["x-should-retry"]).toBe("false")
          }
        }
      }),
    )
  }

  it.effect("preserves numeric and string HTTP/SSE billing, throttle, and server codes", () =>
    Effect.gen(function* () {
      for (const status of [402, 429, 500, 503]) {
        for (const code of [status, String(status)]) {
          for (const transport of [status, 200]) {
            const cause = yield* LLM.stream(request()).pipe(
              Stream.runCollect,
              Effect.flip,
              Effect.provide(runtime(() => response({ error: { code, message: "Rejected" } }, transport))),
            )
            const result = yield* decide(cause)
            expect(result.decision.retry).toBe(status !== 402)
            expect(JSON.parse(result.error.response!.body).error.code).toBe(code)
            expect(result.error.status).toBe(transport)
          }
        }
      }
    }),
  )

  it.effect("retains existing Kilo action errors without disabling transient retries", () =>
    Effect.gen(function* () {
      for (const entry of [
        { code: "usage_limit_exceeded", status: 429, retry: false },
        { code: "insufficient_credits", status: 402, retry: false },
        { code: "model_not_allowed", status: 403, retry: false },
        { code: "provider_not_allowed", status: 403, retry: false },
        { code: "data_collection_required", status: 400, retry: false },
        { code: "upgrade_required", status: 426, retry: false },
        { code: "top_up_in_progress", status: 503, retry: true },
        { code: "rate_limit_exceeded", status: 429, retry: true },
        { code: "server_is_overloaded", status: 503, retry: true },
      ]) {
        for (const status of [200, entry.status]) {
          const cause = yield* LLM.stream(request()).pipe(
            Stream.runCollect,
            Effect.flip,
            Effect.provide(
              runtime(() => response({ error: { code: entry.code, message: "Fixture guidance" } }, status)),
            ),
          )
          const result = yield* decide(cause)
          expect(result.decision.retry).toBe(entry.retry)
          expect(result.error.message).toContain("Fixture guidance")
        }
      }
    }),
  )

  it.effect("reads response.failed, bare errors, and JSON inside an outer message through the native dialects", () =>
    Effect.gen(function* () {
      const error = { code: "PAID_MODEL_AUTH_REQUIRED", message: "Rejected", detail: "fixture detail" }
      for (const [index, body] of [
        { type: "response.failed", response: { id: "resp_failed", error } },
        error,
        { type: "error", message: JSON.stringify({ error }) },
      ].entries()) {
        const selected = dialects[index === 0 ? 1 : index === 1 ? 0 : 2].model
        const cause = yield* LLM.stream(request(selected)).pipe(
          Stream.runCollect,
          Effect.flip,
          Effect.provide(runtime(() => response(body))),
        )
        const result = yield* decide(cause, selected)
        expect(result.decision).toEqual({ retry: false })
        expect(result.error.message).toContain("sign in")
        expect(JSON.parse(result.error.response!.body).error).toMatchObject({
          code: error.code,
          detail: error.detail,
          retryable: false,
        })
      }
    }),
  )

  it.effect("keeps billing metadata in the user error and Retry-After in the actual retry decision", () =>
    Effect.gen(function* () {
      const billing = yield* LLM.stream(request()).pipe(
        Stream.runCollect,
        Effect.flip,
        Effect.provide(
          runtime(() =>
            response({
              error: { code: 402, message: "No credits", metadata: { buyCreditsUrl: "https://kilo.ai/billing" } },
            }),
          ),
        ),
      )
      expect((yield* decide(billing)).error.message).toContain("Buy credits at https://kilo.ai/billing")
      const limited = yield* LLM.stream(request()).pipe(
        Stream.runCollect,
        Effect.flip,
        Effect.provide(
          runtime(() => response({ error: { code: 429, message: "Slow down" } }, 429, { "retry-after": "12" })),
        ),
      )
      expect(limited.reason.http?.headers["retry-after"]).toBe("12")
      expect((yield* decide(limited)).decision).toMatchObject({ retry: true, delay: 12_000 })
    }),
  )

  it.effect("leaves unknown Kilo and non-Kilo provider errors on the native retry default", () =>
    Effect.gen(function* () {
      const kiloCause = yield* LLM.stream(request()).pipe(
        Stream.runCollect,
        Effect.flip,
        Effect.provide(
          runtime(() => response({ error: { code: "new_provider_error", message: "Unrecognized failure" } })),
        ),
      )
      expect(kiloCause.reason._tag).toBe("UnknownProvider")
      expect(kiloCause.reason.http?.headers["x-should-retry"]).toBeUndefined()
      expect((yield* decide(kiloCause)).decision.retry).toBe(true)
      const selected = LanguageModel.update(model, { provider: "other" })
      const cause = yield* LLM.stream(request(selected)).pipe(
        Stream.runCollect,
        Effect.flip,
        Effect.provide(
          runtime(() => response({ error: { code: "new_provider_error", message: "Unrecognized failure" } }), false),
        ),
      )
      expect(cause.reason._tag).toBe("UnknownProvider")
      expect(cause.reason.http?.headers["x-should-retry"]).toBeUndefined()
      expect((yield* decide(cause, selected)).decision.retry).toBe(true)
    }),
  )

  it.effect("keeps exhausted quota terminal in HTTP and SSE and respects explicit retry headers", () =>
    Effect.gen(function* () {
      for (const entry of [
        { code: "insufficient_quota", status: 429, retry: false, override: undefined },
        { code: "insufficient_quota", status: 200, retry: false, override: undefined },
        { code: "PAID_MODEL_AUTH_REQUIRED", status: 200, retry: false, override: "true" },
        { code: "top_up_in_progress", status: 200, retry: false, override: "false" },
        { code: "server_error", status: 503, retry: false, override: "false" },
        { code: "PAID_MODEL_AUTH_REQUIRED", status: 401, retry: false, override: "true" },
      ]) {
        const cause = yield* LLM.stream(request()).pipe(
          Stream.runCollect,
          Effect.flip,
          Effect.provide(
            runtime(() =>
              response(
                { error: { code: entry.code, type: "invalid_request_error", message: "Rejected" } },
                entry.status,
                entry.override === undefined ? undefined : { "x-should-retry": entry.override },
              ),
            ),
          ),
        )
        expect((yield* decide(cause)).decision.retry).toBe(entry.retry)
        if (entry.override !== undefined) expect(cause.reason.http?.headers["x-should-retry"]).toBe(String(entry.retry))
        else expect(cause.reason.http?.headers["x-should-retry"]).not.toBe("true")
      }
    }),
  )

  it.effect("retains the explicit free-usage cap for generic api_error bodies", () =>
    Effect.gen(function* () {
      for (const status of [200, 500]) {
        const cause = yield* LLM.stream(request()).pipe(
          Stream.runCollect,
          Effect.flip,
          Effect.provide(runtime(() => response({ error: { message: "FreeUsageLimitError" } }, status))),
        )
        expect((yield* decide(cause)).decision.retry).toBe(false)
        expect(cause.reason.http?.headers["x-should-retry"]).toBe("false")
      }
    }),
  )

  it.effect("does not promote deterministic native failures through message heuristics or generic api_error", () =>
    Effect.gen(function* () {
      for (const dialect of dialects) {
        for (const entry of [
          { status: 400, body: { error: { code: "invalid_request_error", message: "Input has 500 tokens" } } },
          { status: 400, body: { error: { code: "invalid_request_error", message: "Provider returned error" } } },
          { status: 400, body: { message: "Provider returned error" } },
          ...["insufficient_quota", "usage_not_included", "billing_error", "creditlimitexceeded"].map((code) => ({
            status: 429,
            body: { error: { code, message: "Quota exhausted" } },
          })),
        ]) {
          const cause = yield* LLM.stream(request(dialect.model)).pipe(
            Stream.runCollect,
            Effect.flip,
            Effect.provide(runtime(() => response(entry.body, entry.status))),
          )
          expect((yield* decide(cause, dialect.model)).decision.retry).toBe(false)
          expect(cause.reason.http?.headers["x-should-retry"]).not.toBe("true")
        }
      }
    }),
  )

  it.effect("preserves a terminal outer error when its message also contains an unrelated JSON object", () =>
    Effect.gen(function* () {
      for (const dialect of dialects) {
        for (const status of [200, 429]) {
          const cause = yield* LLM.stream(request(dialect.model)).pipe(
            Stream.runCollect,
            Effect.flip,
            Effect.provide(
              runtime(() =>
                response({ error: { code: "PROMOTION_MODEL_LIMIT_REACHED" }, message: '{"foo":"bar"}' }, status),
              ),
            ),
          )
          const result = yield* decide(cause, dialect.model)
          expect(result.decision.retry).toBe(false)
          expect(result.error.message).toContain("sign up")
        }
      }
    }),
  )

  it.effect("keeps the error code rather than the frame marker in bare Anthropic errors", () =>
    Effect.gen(function* () {
      const selected = dialects[2].model
      const cause = yield* LLM.stream(request(selected)).pipe(
        Stream.runCollect,
        Effect.flip,
        Effect.provide(runtime(() => response({ type: "error", code: "rate_limit_exceeded", message: "Slow down" }))),
      )
      expect(toSessionError(cause).message).toBe("rate_limit_exceeded: Slow down")
      expect((yield* decide(cause, selected)).decision.retry).toBe(true)
    }),
  )

  it.effect("keeps interrupted native streams on the default transport retry path", () =>
    Effect.gen(function* () {
      const cause = yield* LLM.stream(request()).pipe(
        Stream.runCollect,
        Effect.flip,
        Effect.provide(
          layer(
            truncatedStream([
              `data: ${JSON.stringify({ choices: [{ delta: { content: "Partial" }, finish_reason: null }] })}\n\n`,
            ]),
          ),
        ),
      )
      expect(cause.reason).toMatchObject({ _tag: "Transport", operation: "read" })
      expect(cause.reason.http?.headers["x-should-retry"]).toBeUndefined()
      expect((yield* decide(cause)).decision.retry).toBe(true)
    }),
  )

  it.effect("does not trust absent, malformed, or contradictory wire retryable values", () =>
    Effect.gen(function* () {
      for (const retryable of [undefined, true, false, "false", 0, null]) {
        for (const code of ["PAID_MODEL_AUTH_REQUIRED", "server_error"]) {
          const cause = yield* LLM.stream(request()).pipe(
            Stream.runCollect,
            Effect.flip,
            Effect.provide(runtime(() => response({ error: { code, message: "Rejected", retryable } }), false)),
          )
          expect((yield* decide(cause)).decision.retry).toBe(code === "server_error")
        }
      }
    }),
  )

  it.effect("retries buffered generation once for a top-up and stops a permanent error after one call", () =>
    Effect.gen(function* () {
      for (const permanent of [false, true]) {
        let calls = 0
        const failed = yield* Deferred.make<void>()
        const program = Effect.gen(function* () {
          const client = yield* LLMClient.Service
          return yield* client.generate(request()).pipe(
            Effect.tapError(() => Deferred.succeed(failed, undefined)),
            ModelRetry.retry,
            Effect.result,
          )
        }).pipe(
          Effect.provide(
            runtime(() => {
              calls++
              if (permanent || calls === 1)
                return response({
                  error: {
                    code: permanent ? "PAID_MODEL_AUTH_REQUIRED" : "top_up_in_progress",
                    type: "invalid_request_error",
                    message: "Pending",
                  },
                })
              return response({ choices: [{ delta: { content: "Recovered" }, finish_reason: "stop" }] })
            }),
          ),
        )
        const fiber = yield* program.pipe(Effect.forkChild)
        yield* Deferred.await(failed)
        yield* TestClock.adjust("3 seconds")
        const result = yield* Fiber.join(fiber)
        expect(calls).toBe(permanent ? 1 : 2)
        if (result._tag === "Success") expect(result.success.text).toBe("Recovered")
        expect(result._tag).toBe(permanent ? "Failure" : "Success")
      }
    }),
  )

  it.effect("retries native trigger compaction once for a top-up and stops permanent errors after one call", () =>
    Effect.gen(function* () {
      const input = request(dialects[1].model)
      if (!LLMClient.canCompact(input, { mechanism: "trigger" }))
        throw new Error("Fixture must support trigger compaction")
      for (const frame of ["error", "response.failed"]) {
        for (const code of ["PAID_MODEL_AUTH_REQUIRED", "PROMOTION_MODEL_LIMIT_REACHED", "top_up_in_progress"]) {
          const permanent = code !== "top_up_in_progress"
          let calls = 0
          const failed = yield* Deferred.make<void>()
          const program = LLMClient.compact(input, { mechanism: "trigger" }).pipe(
            Effect.tapError(() => Deferred.succeed(failed, undefined)),
            ModelRetry.retry,
            Effect.result,
            Effect.provide(
              runtime(() => {
                calls++
                if (calls === 1) {
                  const error = { code, ...(permanent ? {} : { type: "invalid_request_error" }), message: "Pending" }
                  return response(
                    frame === "error"
                      ? { type: frame, error }
                      : { type: frame, response: { id: "resp_failed", error } },
                  )
                }
                return response({
                  type: "response.completed",
                  response: {
                    id: "resp_compacted",
                    output: [{ type: "compaction", id: "cmp_compacted", encrypted_content: "fixture" }],
                  },
                })
              }),
            ),
          )
          const fiber = yield* program.pipe(Effect.forkChild)
          yield* Deferred.await(failed)
          yield* TestClock.adjust("3 seconds")
          const result = yield* Fiber.join(fiber)
          expect(calls).toBe(permanent ? 1 : 2)
          expect(result._tag).toBe(permanent ? "Failure" : "Success")
          if (result._tag === "Failure") {
            expect((yield* decide(result.failure, dialects[1].model)).decision.retry).toBe(false)
          }
          if (result._tag === "Success") {
            expect(result.success.responseID).toBe("resp_compacted")
            expect(result.success.checkpoint).toMatchObject({ id: "cmp_compacted", encrypted: "fixture" })
          }
        }
      }
    }),
  )
})
