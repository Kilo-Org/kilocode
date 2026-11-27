export * as GatewayCoalesce from "./coalesce.js"

import { createHash } from "node:crypto"
import { KiloDefaults, KiloModels, KiloModes, KiloProfile, KiloServer } from "@kilocode/gateway-core"
import { Deferred, Effect, Fiber, Option } from "effect"

interface Flight {
  readonly deferred: Deferred.Deferred<unknown, unknown>
  fiber?: Fiber.Fiber<void, never>
  waiters: number
  settled: boolean
}

const flights = new Map<string, Flight>()

export function tokenHash(token: string | undefined): string {
  if (token === undefined) return "none"
  if (token === "") return "empty"
  return createHash("sha256").update(token).digest("hex")
}

/**
 * Coalesces concurrent calls with the same key into one detached in-flight execution.
 *
 * Waiters are reference-counted: disposing or interrupting one caller leaves the shared work
 * running for remaining joiners, and interrupting the last waiter cancels the detached fiber.
 */
export function run<A, E>(key: string, load: () => Effect.Effect<A, E>): Effect.Effect<A, E> {
  return Effect.uninterruptibleMask((restore) =>
    Effect.suspend(() => {
      const existing = flights.get(key)
      if (existing) {
        existing.waiters++
        return awaitFlight<A, E>(key, existing, restore)
      }
      // Register the flight synchronously before any fiber yield so concurrent joiners cannot race past it.
      const flight: Flight = {
        deferred: Deferred.makeUnsafe<unknown, unknown>(),
        waiters: 1,
        settled: false,
      }
      flights.set(key, flight)
      return Effect.gen(function* () {
        flight.fiber = yield* Effect.exit(load()).pipe(
          Effect.flatMap((exit) =>
            Effect.gen(function* () {
              flight.settled = true
              if (flights.get(key) === flight) flights.delete(key)
              yield* Deferred.done(flight.deferred, exit)
            }),
          ),
          Effect.ensuring(
            Effect.sync(() => {
              flight.settled = true
              if (flights.get(key) === flight) flights.delete(key)
            }),
          ),
          Effect.forkDetach({ startImmediately: true }),
        )
        return yield* awaitFlight<A, E>(key, flight, restore)
      })
    }),
  )
}

export function profile(
  api: string,
  token: string,
): Effect.Effect<{
  readonly profile: Option.Option<KiloProfile.Info>
  readonly failure?: KiloProfile.ProfileError["reason"]
}> {
  const key = JSON.stringify(["profile", KiloServer.normalize(api), tokenHash(token)])
  return run(key, () =>
    KiloProfile.get(api, token).pipe(
      Effect.map((info) => ({ profile: Option.some(info) })),
      Effect.catch((error) => Effect.succeed({ profile: Option.none<KiloProfile.Info>(), failure: error.reason })),
    ),
  )
}

export function modes(
  api: string,
  token: string,
  organizationID: string,
  version: string,
): Effect.Effect<readonly KiloModes.OrganizationMode[]> {
  const key = JSON.stringify(["modes", KiloServer.normalize(api), organizationID, version, tokenHash(token)])
  return run(key, () => KiloModes.get(api, token, organizationID, version))
}

export function catalog(input: {
  readonly api: string
  readonly base: string
  readonly token?: string
  readonly organizationID: string | null
  readonly version: string
}) {
  const key = JSON.stringify([
    "catalog",
    KiloServer.normalize(input.api),
    KiloServer.normalize(input.base),
    input.organizationID,
    input.version,
    tokenHash(input.token),
  ])
  return run(key, () =>
    Effect.all(
      [
        KiloModels.get({
          server: input.base,
          token: input.token,
          organizationID: input.organizationID,
          version: input.version,
        }).pipe(Effect.result),
        KiloDefaults.get({
          server: input.api,
          token: input.token,
          organizationID: input.organizationID,
          endpoint: input.base,
        }),
      ],
      { concurrency: 2 },
    ),
  )
}

function awaitFlight<A, E>(
  key: string,
  flight: Flight,
  restore: <B, F, R>(effect: Effect.Effect<B, F, R>) => Effect.Effect<B, F, R>,
): Effect.Effect<A, E> {
  return restore(Deferred.await(flight.deferred) as Effect.Effect<A, E>).pipe(
    Effect.onExit(() =>
      Effect.gen(function* () {
        flight.waiters--
        if (flight.waiters > 0) return
        if (flights.get(key) === flight) flights.delete(key)
        if (!flight.settled && flight.fiber) yield* Fiber.interrupt(flight.fiber)
      }),
    ),
  )
}
