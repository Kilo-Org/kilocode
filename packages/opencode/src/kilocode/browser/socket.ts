// Per-user CLI socket. The run directory is 0700 and owned by the current user, so
// only that user can connect; the hub also refuses a directory it cannot vouch for.
import path from "path"
import fs from "fs/promises"
import { createServer } from "node:net"
import { Log } from "@opencode-ai/core/util/log"
import { Paths } from "./paths"
import { PeerLimit, decoder, encode } from "./frame"
import { CliToHub } from "./protocol"
import type { HubToCli } from "./protocol"

const log = Log.create({ service: "browser.socket" })

export type Connection = {
  send(frame: HubToCli): void
  close(): void
  // Called once when the peer goes away, after which the connection can be forgotten.
  onClose(fn: () => void): void
}

export type Server = {
  readonly path: string
  close(): Promise<void>
}

export async function serve(input: {
  path: string
  open(connection: Connection): (frame: CliToHub) => void
}): Promise<Server> {
  if (process.platform !== "win32") {
    await Paths.ensure(path.dirname(input.path), true)
    // A leftover socket file means the hub that owned it died without cleaning up.
    await fs.rm(input.path, { force: true })
  }

  const server = createServer((socket) => {
    const state = { closed: false }
    const listeners: (() => void)[] = []
    const handlers = { frame: (_: CliToHub) => {} }

    const shut = () => {
      if (state.closed) return
      state.closed = true
      for (const listener of listeners) listener()
    }

    const connection: Connection = {
      send(frame) {
        if (state.closed) return
        try {
          socket.write(encode(frame))
        } catch (error) {
          log.warn("cannot write to a CLI socket", { error })
        }
      },
      close() {
        if (state.closed) return
        socket.end()
        shut()
      },
      onClose(fn) {
        listeners.push(fn)
      },
    }

    const frames = decoder({
      limit: PeerLimit,
      onFrame(value) {
        const parsed = CliToHub.safeParse(value)
        if (!parsed.success) {
          log.warn("closing a CLI socket that sent an invalid frame", { issues: parsed.error.issues })
          connection.close()
          return
        }
        handlers.frame(parsed.data)
      },
      onError(error) {
        log.warn("closing a CLI socket after a framing error", { error })
        connection.close()
      },
    })

    socket.setNoDelay(true)
    socket.on("data", (chunk) => frames.push(chunk))
    socket.on("end", () => connection.close())
    socket.on("error", (error) => {
      log.warn("CLI socket error", { error })
      connection.close()
    })
    socket.on("close", shut)

    handlers.frame = input.open(connection)
  })

  server.on("error", (error) => log.error("CLI socket server error", { error }))
  const listening = Promise.withResolvers<void>()
  server.once("error", listening.reject)
  server.listen(input.path, () => {
    server.removeListener("error", listening.reject)
    listening.resolve()
  })
  await listening.promise

  return {
    path: input.path,
    async close() {
      const closed = Promise.withResolvers<void>()
      server.close(() => closed.resolve())
      await closed.promise
      if (process.platform !== "win32") await fs.rm(input.path, { force: true })
    },
  }
}
