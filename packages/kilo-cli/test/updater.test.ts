import { describe, expect, test } from "bun:test"
import { Updater } from "@opencode/cli/services/updater"
import { OPENCODE_VERSION } from "@opencode/cli/version"
import { Effect, Option } from "effect"
import { KiloUpdater } from "../src/updater"
import upgrade from "../src/upgrade"

describe("KiloUpdater", () => {
  test("background checks return no banner and do not start an install", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const updater = yield* Updater.Service
        const installed: string[] = []
        expect(yield* updater.run()).toBeUndefined()
        expect(yield* updater.run((version) => installed.push(version))).toBeUndefined()
        expect(installed).toEqual([])
      }).pipe(Effect.provide(KiloUpdater.layer)),
    )
  })

  test("manual checks return the Kilo manual update instructions", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const updater = yield* Updater.Service
        expect(KiloUpdater.message).toBe(
          "Kilo updates are disabled. Update Kilo manually using the method used to install this build.",
        )
        expect(yield* updater.check()).toEqual({ type: "unavailable", message: KiloUpdater.message })
      }).pipe(Effect.provide(KiloUpdater.layer)),
    )
  })

  test("installation methods and removal commands stay unavailable", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const updater = yield* Updater.Service
        expect(yield* updater.method()).toBeUndefined()
        Updater.methods.forEach((method) => expect(updater.removal(method)).toBeUndefined())
      }).pipe(Effect.provide(KiloUpdater.layer)),
    )
  })

  test.each([OPENCODE_VERSION, `v${OPENCODE_VERSION}`, "2.0.0", "invalid", ""])(
    "apply rejects version %s with a typed error",
    async (version) => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const updater = yield* Updater.Service
          const error = yield* updater.apply(version).pipe(Effect.flip)
          expect(error).toBeInstanceOf(Error)
          expect(error.message).toBe(KiloUpdater.message)
        }).pipe(Effect.provide(KiloUpdater.layer)),
      )
    },
  )

  test.each([undefined, ...Updater.methods])("latest rejects method %s with a typed error", async (method) => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const updater = yield* Updater.Service
        const error = yield* updater.latest(method).pipe(Effect.flip)
        expect(error).toBeInstanceOf(Error)
        expect(error.message).toBe(KiloUpdater.message)
      }).pipe(Effect.provide(KiloUpdater.layer)),
    )
  })

  test.each([...Updater.methods])("upgrade rejects method %s with a typed error", async (method) => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const updater = yield* Updater.Service
        yield* Effect.forEach([OPENCODE_VERSION, `v${OPENCODE_VERSION}`, "2.0.0", "invalid", ""], (version) =>
          Effect.gen(function* () {
            const error = yield* updater.upgrade(method, version).pipe(Effect.flip)
            expect(error).toBeInstanceOf(Error)
            expect(error.message).toBe(KiloUpdater.message)
          }),
        )
      }).pipe(Effect.provide(KiloUpdater.layer)),
    )
  })
})

describe("Kilo upgrade handler", () => {
  test.each([undefined, ...Updater.methods])(
    "rejects every target with method %s without updater services",
    async (method) => {
      await Effect.runPromise(
        Effect.forEach([undefined, OPENCODE_VERSION, `v${OPENCODE_VERSION}`, "2.0.0", "invalid", ""], (target) =>
          Effect.gen(function* () {
            const error = yield* upgrade({
              method: method === undefined ? Option.none() : Option.some(method),
              target: target === undefined ? Option.none() : Option.some(target),
            }).pipe(Effect.flip)
            expect(error).toBeInstanceOf(Error)
            expect(error.message).toBe(KiloUpdater.message)
          }),
        ),
      )
    },
  )
})
