import { Deferred, Effect, Option, Ref, Scope, Semaphore, Stream } from "effect"
import type { Headers } from "effect/unstable/http"
import * as CassetteService from "./cassette.js"
import { canonicalizeJson, decodeJson, safeText } from "./matching.js"
import { makeReplayState, resolveAutoMode } from "./recorder.js"
import type { RecordReplayMode } from "./internal-effect.js"
import { make, type Redactor } from "./redactor.js"
import { webSocketInteractions, type CassetteMetadata, type WebSocketEvent } from "./schema.js"

export interface WebSocketRequest {
  readonly url: string
  readonly headers: Headers.Headers
}

export interface WebSocketConnection<E> {
  readonly sendText: (message: string) => Effect.Effect<void, E>
  readonly messages: Stream.Stream<string | Uint8Array, E>
  readonly close: Effect.Effect<void>
}

export interface WebSocketExecutor<E> {
  readonly open: (request: WebSocketRequest) => Effect.Effect<WebSocketConnection<E>, E>
}

export interface WebSocketRecordReplayOptions<E> {
  readonly name: string
  readonly mode?: RecordReplayMode
  readonly metadata?: CassetteMetadata
  readonly cassette: CassetteService.Interface
  readonly live: WebSocketExecutor<E>
  readonly redactor?: Redactor
  readonly compareClientMessagesAsJson?: boolean
}

const headersRecord = (headers: Headers.Headers): Record<string, string> =>
  Object.fromEntries(
    Object.entries(headers as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  )

const textEvent = (direction: "client" | "server", body: string): WebSocketEvent => ({
  direction,
  kind: "text",
  body,
})

const decodeEvent = (event: WebSocketEvent) =>
  event.kind === "text" ? event.body : new Uint8Array(Buffer.from(event.body, "base64"))

const jsonOrText = (value: string) => Option.match(decodeJson(value), { onNone: () => value, onSome: canonicalizeJson })

const assertClientEvent = (actual: string, expected: WebSocketEvent | undefined, index: number, asJson: boolean) =>
  Effect.sync(() => {
    const matches =
      expected?.direction === "client" &&
      expected.kind === "text" &&
      JSON.stringify(asJson ? jsonOrText(actual) : actual) ===
        JSON.stringify(asJson ? jsonOrText(expected.body) : expected.body)
    if (matches) return
    throw new Error(`WebSocket client frame ${index + 1}: expected ${safeText(expected)}, received ${safeText(actual)}`)
  })

export const makeWebSocketExecutor = <E>(
  options: WebSocketRecordReplayOptions<E>,
): Effect.Effect<WebSocketExecutor<E>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const mode =
      !options.mode || options.mode === "auto" ? yield* resolveAutoMode(options.cassette, options.name) : options.mode
    const redactor = options.redactor ?? make()
    const openSnapshot = (request: WebSocketRequest) => {
      const snapshot = redactor.request({
        method: "GET",
        url: request.url,
        headers: headersRecord(request.headers),
        body: "",
      })
      return { url: snapshot.url, headers: snapshot.headers }
    }
    const redactEvent = (event: WebSocketEvent) => {
      if (event.kind === "binary") return event
      const body =
        event.direction === "client"
          ? redactor.request({ method: "WEBSOCKET", url: "", headers: {}, body: event.body }).body
          : redactor.response({ status: 101, headers: {}, body: event.body }).body
      return { ...event, body }
    }

    if (mode === "passthrough") return options.live

    if (mode === "record") {
      return {
        open: (request) =>
          Effect.gen(function* () {
            const events: WebSocketEvent[] = []
            const connection = yield* options.live.open(request)
            const closed = yield* Ref.make(false)
            const closeLock = yield* Semaphore.make(1)
            return {
              sendText: (message) =>
                Effect.sync(() => events.push(redactEvent(textEvent("client", message)))).pipe(
                  Effect.andThen(connection.sendText(message)),
                ),
              messages: connection.messages.pipe(
                Stream.tap((message) =>
                  Effect.sync(() =>
                    events.push(
                      typeof message === "string"
                        ? redactEvent(textEvent("server", message))
                        : {
                            direction: "server",
                            kind: "binary",
                            body: Buffer.from(message).toString("base64"),
                            bodyEncoding: "base64",
                          },
                    ),
                  ),
                ),
              ),
              close: closeLock.withPermit(
                Effect.gen(function* () {
                  if (yield* Ref.get(closed)) return
                  yield* connection.close
                  yield* options.cassette
                    .append(
                      options.name,
                      { transport: "websocket", open: openSnapshot(request), events },
                      options.metadata,
                    )
                    .pipe(Effect.orDie)
                  yield* Ref.set(closed, true)
                }),
              ),
            }
          }),
      }
    }

    const replay = yield* makeReplayState(options.cassette, options.name, webSocketInteractions)
    return {
      open: (request) =>
        Effect.gen(function* () {
          const claimed = yield* replay
            .claim((interaction, index) =>
              Effect.sync(() => {
                const incoming = canonicalizeJson(openSnapshot(request))
                if (interaction && JSON.stringify(incoming) === JSON.stringify(canonicalizeJson(interaction.open)))
                  return
                throw new Error(`WebSocket open ${index + 1} does not match ${safeText(incoming)}`)
              }),
            )
            .pipe(Effect.orDie)
          // kilocode_change start - preserve causal client/server transcript order during replay
          const progress = yield* Ref.make({ position: 0, changed: yield* Deferred.make<void>() })
          const lock = yield* Semaphore.make(1)
          return {
            sendText: (message) =>
              lock.withPermit(
                Effect.gen(function* () {
                  const current = yield* Ref.get(progress)
                  yield* assertClientEvent(
                    message,
                    claimed.interaction.events[current.position],
                    current.position,
                    options.compareClientMessagesAsJson === true,
                  )
                  yield* Ref.set(progress, {
                    position: current.position + 1,
                    changed: yield* Deferred.make<void>(),
                  })
                  yield* Deferred.succeed(current.changed, undefined)
                }),
              ),
            messages: Stream.fromIterable(claimed.interaction.events.map((event, index) => ({ event, index }))).pipe(
              Stream.mapEffect(({ event, index }) =>
                Effect.gen(function* () {
                  const current = yield* Ref.get(progress)
                  if (event.direction === "client") {
                    if (current.position > index) return Option.none<ReturnType<typeof decodeEvent>>()
                    if (current.position < index)
                      return yield* Effect.die(
                        new Error(`WebSocket replay position: expected ${index}, received ${current.position}`),
                      )
                    yield* Deferred.await(current.changed)
                    return Option.none<ReturnType<typeof decodeEvent>>()
                  }
                  if (current.position !== index)
                    return yield* Effect.die(
                      new Error(`WebSocket replay position: expected ${index}, received ${current.position}`),
                    )
                  yield* Ref.set(progress, {
                    position: index + 1,
                    changed: yield* Deferred.make<void>(),
                  })
                  return Option.some(decodeEvent(event))
                }),
              ),
              Stream.filter(Option.isSome),
              Stream.map((event) => event.value),
            ),
            close: Effect.gen(function* () {
              const used = (yield* Ref.get(progress)).position
              if (used !== claimed.interaction.events.length)
                return yield* Effect.die(
                  new Error(`WebSocket event count: expected ${claimed.interaction.events.length}, received ${used}`),
                )
            }),
            // kilocode_change end
          }
        }),
    }
  })
