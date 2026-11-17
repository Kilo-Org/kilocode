// Native messaging framing: a 4-byte little-endian length followed by UTF-8 JSON.
// Used on the browser's stdio in native mode and on the per-user CLI socket.
import { Log } from "@opencode-ai/core/util/log"

const log = Log.create({ service: "browser.frame" })

// Chrome rejects host messages over 1 MiB and the spec asks for host -> extension
// frames to stay under 1 MB, so outgoing host frames are capped below both.
export const HostLimit = 1_000_000
// Chrome allows 64 MiB towards the host; Firefox allows 4 GB. Tool results such as
// screenshots need far more than 1 MB in the inbound direction.
export const PeerLimit = 64 * 1024 * 1024

export class FrameError extends Error {
  constructor(
    readonly kind: "too_large" | "bad_json",
    message: string,
  ) {
    super(message)
    this.name = "FrameError"
  }
}

export function encode(value: unknown, limit = PeerLimit): Buffer {
  const body = Buffer.from(JSON.stringify(value), "utf8")
  if (body.length > limit) {
    throw new FrameError("too_large", `frame of ${body.length} bytes exceeds the ${limit} byte limit`)
  }
  const frame = Buffer.allocUnsafe(4 + body.length)
  frame.writeUInt32LE(body.length, 0)
  body.copy(frame, 4)
  return frame
}

export type Decoder = {
  push(chunk: Uint8Array): void
  readonly dead: boolean
}

export type DecodeInput = {
  limit?: number
  onFrame(value: unknown): void
  onError(error: FrameError): void
}

export function decoder(input: DecodeInput): Decoder {
  const limit = input.limit ?? PeerLimit
  const state = {
    head: Buffer.alloc(0),
    need: -1,
    parts: [] as Buffer[],
    got: 0,
    dead: false,
  }

  function fail(error: FrameError) {
    state.dead = true
    state.parts = []
    state.head = Buffer.alloc(0)
    input.onError(error)
  }

  function parse(body: Buffer) {
    if (body.length === 0) {
      fail(new FrameError("bad_json", "empty frame"))
      return false
    }
    try {
      input.onFrame(JSON.parse(body.toString("utf8")))
      return true
    } catch (error) {
      if (error instanceof SyntaxError) {
        fail(new FrameError("bad_json", "frame is not valid JSON"))
        return false
      }
      throw error
    }
  }

  return {
    get dead() {
      return state.dead
    },
    push(chunk) {
      if (state.dead) return
      let view = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
      while (view.length > 0) {
        if (state.need < 0) {
          const take = Math.min(4 - state.head.length, view.length)
          state.head = Buffer.concat([state.head, view.subarray(0, take)])
          view = view.subarray(take)
          if (state.head.length < 4) return
          const need = state.head.readUInt32LE(0)
          state.head = Buffer.alloc(0)
          if (need > limit) {
            fail(new FrameError("too_large", `declared frame of ${need} bytes exceeds the ${limit} byte limit`))
            return
          }
          state.need = need
          state.parts = []
          state.got = 0
          continue
        }
        const take = Math.min(state.need - state.got, view.length)
        state.parts.push(view.subarray(0, take))
        state.got += take
        view = view.subarray(take)
        if (state.got < state.need) return
        const first = state.parts.length === 1 ? state.parts[0] : undefined
        const body = first ?? Buffer.concat(state.parts, state.need)
        state.need = -1
        state.parts = []
        state.got = 0
        if (!parse(body)) return
      }
    },
  }
}

export function write(stream: NodeJS.WritableStream, value: unknown, limit = HostLimit): boolean {
  try {
    return stream.write(encode(value, limit))
  } catch (error) {
    log.error("dropping oversized frame", { error })
    return false
  }
}
