import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { createAppFixture } from "../fixture/app"

const HERDR = ["HERDR_ENV", "HERDR_PANE_ID", "HERDR_SOCKET_PATH"] as const

// Drives the real TUI: the builtin plugin registers, reports, and the app's shutdown finalizers run its cleanup.
test.skipIf(process.platform === "win32")("TUI shutdown waits for Herdr to answer pane.release_agent", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "herdr-app-"))
  const socketPath = path.join(dir, "herdr.sock")
  const previous = HERDR.map((name) => process.env[name])
  const events: string[] = []
  const reported = Promise.withResolvers<void>()
  const server = net.createServer((socket) => {
    socket.on("error", () => undefined)
    socket.on("data", (chunk) => {
      const request = JSON.parse(chunk.toString("utf8")) as { id: string; method: string; params: { pane_id: string } }
      events.push(`${request.method} ${request.params.pane_id}`)
      if (request.method === "pane.report_agent") {
        socket.write(`${JSON.stringify({ id: request.id, result: { type: "ok" } })}\n`)
        reported.resolve()
        return
      }
      // A late answer separates "cleanup was awaited" from "cleanup was started".
      setTimeout(() => {
        events.push("release answered")
        socket.write(`${JSON.stringify({ id: request.id, result: { type: "ok" } })}\n`)
      }, 150)
    })
  })
  await new Promise<void>((resolve) => server.listen(socketPath, resolve))
  process.env.HERDR_ENV = "1"
  process.env.HERDR_PANE_ID = "w1:p1"
  process.env.HERDR_SOCKET_PATH = socketPath
  try {
    const setup = await createAppFixture()
    await setup.ready
    await reported.promise
    await setup[Symbol.asyncDispose]()
    expect(events).toEqual(["pane.report_agent w1:p1", "pane.release_agent w1:p1", "release answered"])
  } finally {
    HERDR.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name]
      else process.env[name] = previous[index]
    })
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await fs.rm(dir, { recursive: true, force: true })
  }
})
