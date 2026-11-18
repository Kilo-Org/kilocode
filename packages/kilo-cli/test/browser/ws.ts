// Minimal WebSocket client for the integration tests. Bun's `ws` import is a
// browser-shaped shim with no way to set an Origin header, which is exactly the
// header the hub checks, so the handshake and frames are written by hand.
import net from "node:net"
import { createHash, randomBytes } from "node:crypto"

const Guid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

export type Socket = {
  status: number
  take(timeout?: number): Promise<string>
  send(text: string): void
  close(): void
  closed: Promise<number>
}

type Head = { status: number; rest: Buffer }

function head(socket: net.Socket, key: string) {
  const deferred = Promise.withResolvers<Head>()
  let buffer = Buffer.alloc(0)
  const expected = createHash("sha1")
    .update(key + Guid)
    .digest("base64")
  socket.on("data", function read(chunk: Buffer) {
    buffer = Buffer.concat([buffer, chunk])
    const end = buffer.indexOf("\r\n\r\n")
    if (end < 0) return
    socket.off("data", read)
    const lines = buffer.subarray(0, end).toString("latin1").split("\r\n")
    const status = Number(lines[0]?.split(" ")[1] ?? 0)
    const accept = lines
      .find((line) => line.toLowerCase().startsWith("sec-websocket-accept:"))
      ?.split(":")[1]
      ?.trim()
    if (status === 101 && accept !== expected) {
      deferred.reject(new Error("the server returned an unexpected Sec-WebSocket-Accept"))
      return
    }
    deferred.resolve({ status, rest: buffer.subarray(end + 4) })
  })
  socket.once("error", deferred.reject)
  return deferred.promise
}

function frame(opcode: number, payload: Buffer) {
  const mask = randomBytes(4)
  const masked = Buffer.alloc(payload.length)
  for (let index = 0; index < payload.length; index++) masked[index] = payload[index] ^ mask[index % 4]
  const header =
    payload.length < 126
      ? Buffer.from([0x80 | opcode, 0x80 | payload.length])
      : payload.length < 65_536
        ? Buffer.from([0x80 | opcode, 0x80 | 126, payload.length >> 8, payload.length & 0xff])
        : (() => {
            const wide = Buffer.alloc(10)
            wide[0] = 0x80 | opcode
            wide[1] = 0x80 | 127
            wide.writeBigUInt64BE(BigInt(payload.length), 2)
            return wide
          })()
  return Buffer.concat([header, mask, masked])
}

export async function connect(input: { port: number; path: string; origin?: string }): Promise<Socket> {
  const key = randomBytes(16).toString("base64")
  const socket = net.createConnection({ host: "127.0.0.1", port: input.port })
  const connected = Promise.withResolvers<void>()
  socket.once("connect", connected.resolve)
  socket.once("error", connected.reject)
  await connected.promise
  socket.on("error", () => undefined)

  const request = [
    `GET ${input.path} HTTP/1.1`,
    `Host: 127.0.0.1:${input.port}`,
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Key: ${key}`,
    "Sec-WebSocket-Version: 13",
    ...(input.origin === undefined ? [] : [`Origin: ${input.origin}`]),
    "",
    "",
  ].join("\r\n")
  socket.write(request)

  const answer = await head(socket, key)
  const state = {
    buffer: answer.rest,
    texts: [] as string[],
    waiters: [] as { resolve(value: string): void; reject(error: Error): void; timer: NodeJS.Timeout }[],
    closeCode: 1006,
    done: false,
    closed: Promise.withResolvers<number>(),
  }

  const send = (opcode: number, payload: Buffer) => {
    if (socket.destroyed) return
    socket.write(frame(opcode, payload))
  }

  const settle = (value: string) => {
    const waiter = state.waiters.shift()
    if (waiter) {
      clearTimeout(waiter.timer)
      waiter.resolve(value)
      return
    }
    state.texts.push(value)
  }

  const finish = (code: number) => {
    if (state.done) return
    state.done = true
    state.closeCode = code
    for (const waiter of state.waiters.splice(0)) {
      clearTimeout(waiter.timer)
      waiter.reject(new Error(`the socket closed with ${code}`))
    }
    state.closed.resolve(code)
  }

  const read = () => {
    while (state.buffer.length >= 2) {
      const first = state.buffer[0]
      const second = state.buffer[1]
      const opcode = first & 0x0f
      const masked = (second & 0x80) !== 0
      let length = second & 0x7f
      let offset = 2
      if (length === 126) {
        if (state.buffer.length < 4) return
        length = state.buffer.readUInt16BE(2)
        offset = 4
      } else if (length === 127) {
        if (state.buffer.length < 10) return
        length = Number(state.buffer.readBigUInt64BE(2))
        offset = 10
      }
      const maskAt = offset
      if (masked) offset += 4
      if (state.buffer.length < offset + length) return
      const raw = state.buffer.subarray(offset, offset + length)
      const payload = Buffer.from(raw)
      if (masked) {
        const mask = state.buffer.subarray(maskAt, maskAt + 4)
        for (let index = 0; index < payload.length; index++) payload[index] = payload[index] ^ mask[index % 4]
      }
      state.buffer = state.buffer.subarray(offset + length)
      if (opcode === 0x1) settle(payload.toString("utf8"))
      else if (opcode === 0x8) {
        const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005
        send(0x8, payload.subarray(0, 2))
        socket.end()
        finish(code)
      } else if (opcode === 0x9) send(0xa, payload)
    }
  }

  socket.on("data", (chunk: Buffer) => {
    state.buffer = Buffer.concat([state.buffer, chunk])
    read()
  })
  socket.on("close", () => finish(state.closeCode))
  read()

  return {
    status: answer.status,
    take(timeout = 5_000) {
      const queued = state.texts.shift()
      if (queued !== undefined) return Promise.resolve(queued)
      const deferred = Promise.withResolvers<string>()
      const waiter = {
        resolve: deferred.resolve,
        reject: deferred.reject,
        timer: setTimeout(() => {
          const at = state.waiters.indexOf(waiter)
          if (at >= 0) state.waiters.splice(at, 1)
          deferred.reject(new Error("timed out waiting for a WebSocket message"))
        }, timeout),
      }
      state.waiters.push(waiter)
      return deferred.promise
    },
    send(text) {
      send(0x1, Buffer.from(text, "utf8"))
    },
    close() {
      if (state.done) return
      send(0x8, Buffer.from([0x03, 0xe8]))
      socket.end()
      finish(1000)
    },
    closed: state.closed.promise,
  }
}
