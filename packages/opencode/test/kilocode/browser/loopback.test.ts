// The loopback hub's origin gate and its idle-lifecycle rules, in process so the
// activity bookkeeping is observable without a child process.
import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import net from "node:net"
import os from "os"
import path from "path"
import { StoreExtensionId } from "../../../src/kilocode/browser/protocol"
import * as pair from "../../../src/kilocode/browser/pair"
import { Registry } from "../../../src/kilocode/browser/registry"
import { run, trusted } from "../../../src/kilocode/browser/loopback"
import { until } from "./fixture"

const allowed = [StoreExtensionId]

const roots: string[] = []
const restore: (() => void)[] = []
const sockets: net.Socket[] = []

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy()
  for (const undo of restore.splice(0)) undo()
  for (const at of roots.splice(0)) await fs.rm(at, { recursive: true, force: true })
})

async function freePort() {
  const server = net.createServer()
  const listening = Promise.withResolvers<number>()
  server.once("error", listening.reject)
  server.listen(0, "127.0.0.1", () => {
    const address = server.address()
    listening.resolve(typeof address === "object" && address !== null ? address.port : 0)
  })
  const port = await listening.promise
  const closed = Promise.withResolvers<void>()
  server.close(() => closed.resolve())
  await closed.promise
  return port
}

describe("loopback origin gate", () => {
  test("pins the Chromium origin to the allowed extension ids", () => {
    expect(trusted({ origin: `chrome-extension://${StoreExtensionId}`, host: "127.0.0.1:47917", allowed })).toBe(true)
    expect(trusted({ origin: `chrome-extension://${"c".repeat(32)}`, host: "127.0.0.1:47917", allowed })).toBe(false)
    expect(trusted({ origin: `chrome-extension://${StoreExtensionId}`, host: "example.com", allowed })).toBe(false)
    expect(trusted({ origin: `chrome-extension://${StoreExtensionId}`, host: "[::1]:47917", allowed })).toBe(true)
  })

  test("accepts only an extension-shaped Firefox origin", () => {
    // Firefox reports a per-profile uuid, not the add-on's Gecko ID, so the shape is
    // all the origin check can test; the HMAC over the pairing key authenticates.
    expect(
      trusted({ origin: "moz-extension://6f1c2f7e-0d3f-4b1f-8a54-9d0e7a1c2b3d", host: "127.0.0.1:47917", allowed }),
    ).toBe(true)
    expect(trusted({ origin: "moz-extension://not-a-uuid", host: "127.0.0.1:47917", allowed })).toBe(false)
    expect(trusted({ origin: "moz-extension://", host: "127.0.0.1:47917", allowed })).toBe(false)
  })

  test("refuses a web page and a missing origin", () => {
    expect(trusted({ origin: "https://example.com", host: "127.0.0.1:47917", allowed })).toBe(false)
    expect(trusted({ host: "127.0.0.1:47917", allowed })).toBe(false)
  })
})

describe("loopback idle lifecycle", () => {
  async function startHub() {
    const at = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-loopback-unit-"))
    roots.push(at)
    const before = { run: process.env.KILO_BROWSER_RUN_DIR, data: process.env.KILO_BROWSER_DATA_DIR }
    process.env.KILO_BROWSER_RUN_DIR = path.join(at, "run")
    process.env.KILO_BROWSER_DATA_DIR = path.join(at, "data")
    restore.push(() => {
      if (before.run === undefined) delete process.env.KILO_BROWSER_RUN_DIR
      else process.env.KILO_BROWSER_RUN_DIR = before.run
      if (before.data === undefined) delete process.env.KILO_BROWSER_DATA_DIR
      else process.env.KILO_BROWSER_DATA_DIR = before.data
    })

    const port = await freePort()
    const exit = Promise.withResolvers<number>()
    let stopped = false
    // Not awaited: `run` resolves only when the hub stops, which is what this test
    // observes. `exit` records the code the hub asked for.
    const finished = run({
      port,
      idleMs: 200,
      exit: (code) => {
        stopped = true
        exit.resolve(code)
      },
    })
    const entry = await until(async () => (await Registry.list({ dir: path.join(at, "run", "hubs") })).at(0), 10_000)
    return { at, port, entry, finished, exit, stopped: () => stopped }
  }

  function track(socket: net.Socket) {
    sockets.push(socket)
    return socket
  }

  test("stays up while a CLI client is connected and exits after it leaves", async () => {
    const hub = await startHub()
    const socket = track(net.createConnection(hub.entry.socket))
    const connected = Promise.withResolvers<void>()
    socket.once("connect", connected.resolve)
    socket.once("error", connected.reject)
    await connected.promise
    // The idle interval is one second, so staying attached past it proves the
    // window is measured from activity rather than from process start.
    await Bun.sleep(1_300)
    expect(hub.stopped()).toBe(false)
    socket.end()
    expect(await hub.finished).toBeUndefined()
    expect(await hub.exit.promise).toBe(0)
  }, 10_000)

  test("stays up during a handshake that has not authenticated yet", async () => {
    const hub = await startHub()
    const socket = track(net.createConnection({ host: "127.0.0.1", port: hub.port }))
    const connected = Promise.withResolvers<void>()
    socket.once("connect", connected.resolve)
    socket.once("error", connected.reject)
    await connected.promise
    socket.write(
      [
        `GET ${pair.SocketPath} HTTP/1.1`,
        `Host: 127.0.0.1:${hub.port}`,
        `Origin: chrome-extension://${StoreExtensionId}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
        "Sec-WebSocket-Version: 13",
        "",
        "",
      ].join("\r\n"),
    )
    // Read the challenge but never answer it: the transport is still handshaking.
    const challenge = Promise.withResolvers<void>()
    socket.once("data", () => challenge.resolve())
    await challenge.promise
    await Bun.sleep(1_300)
    expect(hub.stopped()).toBe(false)
    socket.destroy()
    expect(await hub.finished).toBeUndefined()
    expect(await hub.exit.promise).toBe(0)
  }, 10_000)
})
