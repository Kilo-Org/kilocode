import { Effect } from "effect"
import type { HttpServerRequest } from "effect/unstable/http"

type Socket = {
  readonly destroyed: boolean
  once(event: "close", handler: () => void): unknown
  off(event: "close", handler: () => void): unknown
}

type Incoming = {
  readonly aborted: boolean
  readonly socket: Socket
  once(event: "aborted", handler: () => void): unknown
  off(event: "aborted", handler: () => void): unknown
}

function isIncoming(source: object): source is Incoming {
  return "aborted" in source && "socket" in source
}

function aborted(signal: AbortSignal) {
  return Effect.callback<void>((resume) => {
    if (signal.aborted) return resume(Effect.void)
    const handler = () => resume(Effect.void)
    signal.addEventListener("abort", handler, { once: true })
    return Effect.sync(() => signal.removeEventListener("abort", handler))
  })
}

// The stream scope owns the GlobalBus subscription, but some client disconnects do not
// interrupt that scope through the current Node HTTP adapter. Every orphaned stream then
// keeps an unbounded event queue alive. Since session.diff events can contain complete,
// multi-megabyte patches, extension reconnects can retain tens of gigabytes in those queues.
// Convert both Web and Node transport disconnects into an Effect that can interrupt the
// stream and run its acquireRelease finalizers immediately.
export function disconnect(request: HttpServerRequest.HttpServerRequest) {
  const source = request.source
  if (source instanceof Request) return aborted(source.signal)
  if (!isIncoming(source)) return Effect.never

  return Effect.callback<void>((resume) => {
    if (source.aborted || source.socket.destroyed) return resume(Effect.void)
    const handler = () => resume(Effect.void)
    source.once("aborted", handler)
    source.socket.once("close", handler)
    return Effect.sync(() => {
      source.off("aborted", handler)
      source.socket.off("close", handler)
    })
  })
}
