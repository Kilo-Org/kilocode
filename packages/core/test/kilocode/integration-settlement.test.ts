import { describe, expect } from "bun:test"
import { Cause, Deferred, Duration, Effect, Exit, Fiber, Layer } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { Integration } from "@opencode-ai/core/integration"
import { Credential } from "@opencode-ai/core/credential"
import { EventV2 } from "@opencode-ai/core/event"
import { it } from "../lib/effect"

// Regression coverage for Kilo's OAuth attempt settlement guards: persistence
// happens before completion is exposed, and settlement is atomic with
// cancellation, expiry, and timeouts.

const layer = Integration.locationLayer.pipe(
  Layer.provide(EventV2.defaultLayer),
  Layer.provide(
    Layer.mock(Credential.Service)({
      create: () => Effect.die("unexpected credential creation"),
      list: () => Effect.succeed([]),
    }),
  ),
)

function connectionLayer(
  created: Array<{
    integrationID: Integration.ID
    label?: string
    value: Credential.Info
  }>,
) {
  return Integration.locationLayer.pipe(
    Layer.provide(EventV2.defaultLayer),
    Layer.provide(
      Layer.mock(Credential.Service)({
        create: (input) =>
          Effect.sync(() => {
            created.push(input)
            return new Credential.Stored({
              id: Credential.ID.create(),
              integrationID: input.integrationID,
              label: input.label ?? "default",
              value: input.value,
            })
          }),
        list: () => Effect.succeed([]),
      }),
    ),
  )
}

describe("Integration settlement guards", () => {
  it.effect("fails auto OAuth when credential persistence fails", () => {
    const failed = Integration.locationLayer.pipe(
      Layer.provide(EventV2.defaultLayer),
      Layer.provide(
        Layer.mock(Credential.Service)({
          create: () => Effect.die(new Error("database unavailable")),
          list: () => Effect.succeed([]),
        }),
      ),
    )
    return Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const integrationID = Integration.ID.make("openai")
      const methodID = Integration.MethodID.make("browser")
      yield* integrations.update((editor) =>
        editor.method.update({
          integrationID,
          method: new Integration.OAuthMethod({ id: methodID, type: "oauth", label: "Browser" }),
          authorize: () =>
            Effect.succeed({
              mode: "auto" as const,
              url: "https://example.com/authorize",
              instructions: "Sign in",
              callback: Effect.succeed(
                new Credential.OAuth({ type: "oauth", methodID, access: "access", refresh: "refresh", expires: 1 }),
              ),
            }),
        }),
      )

      const attempt = yield* integrations.connect.oauth({ integrationID, methodID, inputs: {} })
      yield* Effect.yieldNow
      expect(yield* integrations.attempt.status(attempt.attemptID)).toMatchObject({
        status: "failed",
        message: expect.stringContaining("database unavailable"),
      })
    }).pipe(Effect.provide(failed))
  })

  it.effect("fails code OAuth when credential persistence fails", () => {
    const failed = Integration.locationLayer.pipe(
      Layer.provide(EventV2.defaultLayer),
      Layer.provide(
        Layer.mock(Credential.Service)({
          create: () => Effect.die(new Error("database unavailable")),
          list: () => Effect.succeed([]),
        }),
      ),
    )
    return Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const integrationID = Integration.ID.make("openai")
      const methodID = Integration.MethodID.make("chatgpt")
      yield* integrations.update((editor) =>
        editor.method.update({
          integrationID,
          method: new Integration.OAuthMethod({ id: methodID, type: "oauth", label: "ChatGPT" }),
          authorize: () =>
            Effect.succeed({
              mode: "code" as const,
              url: "https://example.com/authorize",
              instructions: "Paste the code",
              callback: () =>
                Effect.succeed(
                  new Credential.OAuth({ type: "oauth", methodID, access: "access", refresh: "refresh", expires: 1 }),
                ),
            }),
        }),
      )

      const attempt = yield* integrations.connect.oauth({ integrationID, methodID, inputs: {} })
      const exit = yield* integrations.attempt.complete({ attemptID: attempt.attemptID, code: "1234" }).pipe(
        Effect.exit,
      )
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("database unavailable")
      expect(yield* integrations.attempt.status(attempt.attemptID)).toMatchObject({
        status: "failed",
        message: expect.stringContaining("database unavailable"),
      })
    }).pipe(Effect.provide(failed))
  })

  it.effect("lets OAuth persistence finish after concurrent cancellation", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const created: Credential.Stored[] = []
      const delayed = Integration.locationLayer.pipe(
        Layer.provide(EventV2.defaultLayer),
        Layer.provide(
          Layer.mock(Credential.Service)({
            create: (input) =>
              Effect.gen(function* () {
                yield* Deferred.succeed(started, undefined)
                yield* Deferred.await(release)
                const credential = new Credential.Stored({
                  id: Credential.ID.create(),
                  integrationID: input.integrationID,
                  label: input.label ?? "default",
                  value: input.value,
                })
                created.push(credential)
                return credential
              }),
            list: () => Effect.succeed([]),
          }),
        ),
      )

      yield* Effect.gen(function* () {
        const integrations = yield* Integration.Service
        const integrationID = Integration.ID.make("openai")
        const methodID = Integration.MethodID.make("chatgpt")
        yield* integrations.update((editor) =>
          editor.method.update({
            integrationID,
            method: new Integration.OAuthMethod({ id: methodID, type: "oauth", label: "ChatGPT" }),
            authorize: () =>
              Effect.succeed({
                mode: "code" as const,
                url: "https://example.com/authorize",
                instructions: "Paste the code",
                callback: () =>
                  Effect.succeed(
                    new Credential.OAuth({ type: "oauth", methodID, access: "access", refresh: "refresh", expires: 1 }),
                  ),
              }),
          }),
        )

        const attempt = yield* integrations.connect.oauth({ integrationID, methodID, inputs: {} })
        const fiber = yield* integrations.attempt
          .complete({ attemptID: attempt.attemptID, code: "1234" })
          .pipe(Effect.forkScoped)
        yield* Deferred.await(started)
        yield* integrations.attempt.cancel(attempt.attemptID)
        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(fiber)

        expect(created).toHaveLength(1)
        expect(yield* integrations.attempt.status(attempt.attemptID)).toEqual({
          status: "complete",
          time: attempt.time,
        })
      }).pipe(Effect.provide(delayed))
    }),
  )

  it.effect("keeps a code OAuth attempt while its callback is completing", () => {
    const created: Array<{
      integrationID: Integration.ID
      label?: string
      value: Credential.Info
    }> = []
    return Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const integrations = yield* Integration.Service
      const integrationID = Integration.ID.make("openai")
      const methodID = Integration.MethodID.make("chatgpt")
      yield* integrations.update((editor) =>
        editor.method.update({
          integrationID,
          method: new Integration.OAuthMethod({ id: methodID, type: "oauth", label: "ChatGPT" }),
          authorize: () =>
            Effect.succeed({
              mode: "code" as const,
              url: "https://example.com/authorize",
              instructions: "Paste the code",
              callback: () =>
                Deferred.succeed(started, undefined).pipe(
                  Effect.andThen(Deferred.await(release)),
                  Effect.as(
                    new Credential.OAuth({ type: "oauth", methodID, access: "access", refresh: "refresh", expires: 1 }),
                  ),
                ),
            }),
        }),
      )

      const attempt = yield* integrations.connect.oauth({ integrationID, methodID, inputs: {} })
      const fiber = yield* integrations.attempt
        .complete({ attemptID: attempt.attemptID, code: "1234" })
        .pipe(Effect.forkScoped)
      yield* Deferred.await(started)
      yield* integrations.attempt.cancel(attempt.attemptID)
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(fiber)

      expect(created).toHaveLength(1)
      expect(yield* integrations.attempt.status(attempt.attemptID)).toMatchObject({ status: "complete" })
    }).pipe(Effect.provide(connectionLayer(created)))
  })

  it.effect("fails and releases code OAuth attempts when the callback times out", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const state = { closed: false }
      const integrations = yield* Integration.Service
      const integrationID = Integration.ID.make("openai")
      const methodID = Integration.MethodID.make("chatgpt")
      yield* integrations.update((editor) =>
        editor.method.update({
          integrationID,
          method: new Integration.OAuthMethod({ id: methodID, type: "oauth", label: "ChatGPT" }),
          authorize: () =>
            Effect.addFinalizer(() => Effect.sync(() => (state.closed = true))).pipe(
              Effect.as({
                mode: "code" as const,
                url: "https://example.com/authorize",
                instructions: "Paste the code",
                callback: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
              }),
            ),
        }),
      )

      const attempt = yield* integrations.connect.oauth({ integrationID, methodID, inputs: {} })
      const fiber = yield* integrations.attempt
        .complete({ attemptID: attempt.attemptID, code: "1234" })
        .pipe(Effect.exit, Effect.forkScoped)
      yield* Deferred.await(started)
      yield* TestClock.adjust(Duration.seconds(30))
      const exit = yield* Fiber.join(fiber)
      expect(Exit.isFailure(exit)).toBe(true)
      yield* Effect.yieldNow
      expect(yield* integrations.attempt.status(attempt.attemptID)).toMatchObject({ status: "failed" })
      expect(state.closed).toBe(true)
    }).pipe(Effect.provide(layer)),
  )

  it.effect("fails and releases OAuth attempts when credential persistence times out", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      let closed = false
      const stalled = Integration.locationLayer.pipe(
        Layer.provide(EventV2.defaultLayer),
        Layer.provide(
          Layer.mock(Credential.Service)({
            create: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
            list: () => Effect.succeed([]),
          }),
        ),
      )

      yield* Effect.gen(function* () {
        const integrations = yield* Integration.Service
        const integrationID = Integration.ID.make("openai")
        const methodID = Integration.MethodID.make("chatgpt")
        yield* integrations.update((editor) =>
          editor.method.update({
            integrationID,
            method: new Integration.OAuthMethod({ id: methodID, type: "oauth", label: "ChatGPT" }),
            authorize: () =>
              Effect.addFinalizer(() => Effect.sync(() => (closed = true))).pipe(
                Effect.as({
                  mode: "code" as const,
                  url: "https://example.com/authorize",
                  instructions: "Paste the code",
                  callback: () =>
                    Effect.succeed(
                      new Credential.OAuth({ type: "oauth", methodID, access: "access", refresh: "refresh", expires: 1 }),
                    ),
                }),
              ),
          }),
        )

        const attempt = yield* integrations.connect.oauth({ integrationID, methodID, inputs: {} })
        const fiber = yield* integrations.attempt
          .complete({ attemptID: attempt.attemptID, code: "1234" })
          .pipe(Effect.exit, Effect.forkScoped)
        yield* Deferred.await(started)
        yield* TestClock.adjust(Duration.seconds(30))
        const exit = yield* Fiber.join(fiber)
        expect(Exit.isFailure(exit)).toBe(true)
        yield* Effect.yieldNow
        expect(yield* integrations.attempt.status(attempt.attemptID)).toMatchObject({ status: "failed" })
        expect(closed).toBe(true)
      }).pipe(Effect.provide(stalled))
    }),
  )
})
