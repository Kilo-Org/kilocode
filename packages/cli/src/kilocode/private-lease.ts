import { Deferred, Effect, Option, Schema, Stream } from "effect"

const bound = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Struct({ bound: Schema.String })))
const ready = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Struct({ url: Schema.String })))

// A private server may publish its real listening address before its routes finish booting. The first API read
// still waits for the normal ready line. A server which only publishes ready is also a valid peer.
export const privateLease = Effect.fnUntraced(function* <E>(stdout: Stream.Stream<Uint8Array, E>, early = false) {
  const address = yield* Deferred.make<string, Error>()
  const routes = yield* Deferred.make<string, Error>()
  const closed = new Error("Standalone server exited before reporting readiness")
  yield* stdout.pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.runForEach((line) => {
      if (Deferred.isDoneUnsafe(routes)) return Effect.void
      const message = early ? bound(line) : Option.none()
      if (Option.isSome(message)) return Deferred.succeed(address, message.value.bound)
      const peer = ready(line)
      if (Option.isNone(peer)) return Effect.void
      return Deferred.succeed(routes, peer.value.url).pipe(Effect.andThen(Deferred.succeed(address, peer.value.url)))
    }),
    Effect.ensuring(Deferred.fail(address, closed).pipe(Effect.andThen(Deferred.fail(routes, closed)))),
    Effect.forkScoped,
  )
  const connected = Deferred.await(routes)
  const url = yield* Deferred.await(address)
  return {
    url,
    whenReady: early
      ? (signal?: AbortSignal) => Effect.runPromise(connected.pipe(Effect.asVoid), { signal })
      : undefined,
  }
})
