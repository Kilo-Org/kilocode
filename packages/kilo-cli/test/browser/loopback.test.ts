// The loopback hub's origin gate and its idle-lifecycle rules, in process so the
// activity bookkeeping is observable without a child process.
import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import net from "node:net"
import os from "os"
import path from "path"
import * as proto from "../../src/browser/protocol"
import * as pair from "../../src/browser/pair"
import { encode } from "../../src/browser/frame"
import { Registry } from "../../src/browser/registry"
import { run, trusted } from "../../src/browser/loopback"
import { inbox, until } from "./fixture"
import * as raw from "./ws"

const allowed = [proto.StoreExtensionId]

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

// An isolated data and run directory, then a real hub. `allow` is written to
// `allowed.json` before the hub reads it, which is what `install-host` produces.
async function startHub(input: { pairingTtlMs?: number; allow?: string[] } = {}) {
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
  if (input.allow !== undefined) {
    await fs.mkdir(process.env.KILO_BROWSER_DATA_DIR, { recursive: true, mode: 0o700 })
    await fs.writeFile(path.join(process.env.KILO_BROWSER_DATA_DIR, "allowed.json"), JSON.stringify(input.allow))
  }

  const port = await freePort()
  // `run` resolves once the hub is listening; `done` resolves when it stops, which
  // is what these tests observe.
  const running = await run({ port, idleMs: 200, pairingTtlMs: input.pairingTtlMs })
  const entry = await until(async () => (await Registry.list({ dir: path.join(at, "run", "hubs") })).at(0), 10_000)
  return { at, port, entry, done: running.done, stop: running.stop }
}

describe("loopback origin gate", () => {
  test("pins the Chromium origin to the allowed extension ids", () => {
    expect(trusted({ origin: `chrome-extension://${proto.StoreExtensionId}`, host: "127.0.0.1:47917", allowed })).toBe(
      true,
    )
    expect(trusted({ origin: `chrome-extension://${"c".repeat(32)}`, host: "127.0.0.1:47917", allowed })).toBe(false)
    expect(trusted({ origin: `chrome-extension://${proto.StoreExtensionId}`, host: "example.com", allowed })).toBe(
      false,
    )
    expect(trusted({ origin: `chrome-extension://${proto.StoreExtensionId}`, host: "[::1]:47917", allowed })).toBe(true)
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
  function track(socket: net.Socket) {
    sockets.push(socket)
    return socket
  }

  test("stays up while a CLI client is connected and exits after it leaves", async () => {
    const hub = await startHub()
    const ended = { done: false }
    void hub.done.then(() => {
      ended.done = true
    })
    const socket = track(net.createConnection(hub.entry.socket))
    const connected = Promise.withResolvers<void>()
    socket.once("connect", connected.resolve)
    socket.once("error", connected.reject)
    await connected.promise
    // The idle interval is one second, so staying attached past it proves the
    // window is measured from activity rather than from process start.
    await Bun.sleep(1_300)
    expect(ended.done).toBe(false)
    socket.end()
    await hub.done
    expect(ended.done).toBe(true)
  }, 10_000)

  test("stays up during a handshake that has not authenticated yet", async () => {
    const hub = await startHub()
    const ended = { done: false }
    void hub.done.then(() => {
      ended.done = true
    })
    const socket = track(net.createConnection({ host: "127.0.0.1", port: hub.port }))
    const connected = Promise.withResolvers<void>()
    socket.once("connect", connected.resolve)
    socket.once("error", connected.reject)
    await connected.promise
    socket.write(
      [
        `GET ${pair.SocketPath} HTTP/1.1`,
        `Host: 127.0.0.1:${hub.port}`,
        `Origin: chrome-extension://${proto.StoreExtensionId}`,
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
    expect(ended.done).toBe(false)
    socket.destroy()
    await hub.done
    expect(ended.done).toBe(true)
  }, 10_000)

  test("an unauthenticated page cannot keep the hub alive by polling", async () => {
    const hub = await startHub()
    // A web page can reach 127.0.0.1; its pairing-page fetches must not count as
    // activity, so the hub exits on its idle window anyway.
    const deadline = Date.now() + 3_000
    const polling = (async () => {
      while (Date.now() < deadline) {
        await fetch(`http://127.0.0.1:${hub.port}${pair.PairingPath}`).catch(() => undefined)
        await Bun.sleep(200)
      }
    })()
    await hub.done
    await polling
  }, 10_000)
})

describe("loopback pairing", () => {
  const extension = `chrome-extension://${proto.StoreExtensionId}`

  // The CLI side of the pairing ask: framed JSON-RPC on the per-user socket, which
  // only this user can reach. The hub answers it itself; no browser is attached.
  async function ask(entry: { socket: string }) {
    const socket = net.createConnection(entry.socket)
    sockets.push(socket)
    const connected = Promise.withResolvers<void>()
    socket.once("connect", connected.resolve)
    socket.once("error", connected.reject)
    await connected.promise
    const frames = inbox(socket)
    socket.write(encode({ type: "rpc", message: { jsonrpc: "2.0", id: 1, method: "pairing.url", params: {} } }))
    for (;;) {
      const frame = await frames.take(proto.HubToCli)
      // The hub reports its state first; only the rpc frame is the answer.
      if (frame.type !== "rpc") continue
      if (!proto.isResponse(frame.message)) throw new Error("expected an rpc response")
      return proto.HubRequests["pairing.url"].result.parse(frame.message.result)
    }
  }

  function token(url: string) {
    return new URLSearchParams(new URL(url).hash.slice(1)).get("t")
  }

  function redeem(port: number, value: string | null, origin?: string) {
    const target = `http://127.0.0.1:${port}${pair.PairingKeyPath}?t=${value ?? ""}`
    return fetch(target, { headers: origin === undefined ? {} : { origin } })
  }

  test("mints a token over the CLI socket and redeems it once for the key", async () => {
    const hub = await startHub()
    const { url } = await ask(hub.entry)
    // The CLI hands the opener a URL with a single-use token, never the key.
    const page = new URL(url)
    expect(page.pathname).toBe(pair.PairingPath)
    expect(new URLSearchParams(page.hash.slice(1)).get("k")).toBeNull()
    const minted = token(url)
    expect(minted).not.toBeNull()

    const response = await redeem(hub.port, minted, extension)
    expect(response.status).toBe(200)
    expect(response.headers.get("access-control-allow-origin")).toBe(extension)
    const body = pair.KeyExchange.parse(await response.json())
    // The extension receives the durable key here, out of band, and the HMAC
    // handshake it performs next is unchanged.
    expect(body.key).toBe(await pair.load(path.join(hub.at, "data", "pairing.json")))
    expect(body.ws).toBe(pair.ws(hub.port))
    expect(pair.decode(body.key, pair.KeyBytes)).toBeDefined()

    // Single use.
    expect((await redeem(hub.port, minted, extension)).status).toBe(404)
    await hub.stop()
  })

  test("refuses a redemption from a web page and keeps the token unused", async () => {
    const hub = await startHub()
    const minted = token((await ask(hub.entry)).url)
    expect((await redeem(hub.port, minted, "https://example.com")).status).toBe(403)
    expect((await redeem(hub.port, minted)).status).toBe(403)
    // A refused request must not consume the token the real extension is about to use.
    expect((await redeem(hub.port, minted, extension)).status).toBe(200)
    await hub.stop()
  })

  test("expires a token that is never redeemed", async () => {
    // Real expiry against the platform clock: the TTL is the behavior under test.
    const hub = await startHub({ pairingTtlMs: 50 })
    const minted = token((await ask(hub.entry)).url)
    await Bun.sleep(150)
    expect((await redeem(hub.port, minted, extension)).status).toBe(404)
    await hub.stop()
  })

  test("admits an id persisted by install-host, like native mode", async () => {
    const extra = "b".repeat(32)
    const hub = await startHub({ allow: [proto.StoreExtensionId, extra] })
    // The environment of this test does not carry the id; the installed allowlist is
    // the only source that can admit it.
    expect(process.env.KILO_BROWSER_EXTRA_EXTENSION_IDS ?? "").not.toContain(extra)
    const socket = await raw.connect({ port: hub.port, path: pair.SocketPath, origin: `chrome-extension://${extra}` })
    expect(socket.status).toBe(101)
    socket.close()
    await hub.stop()
  }, 10_000)

  test("refuses an id that the persisted allowlist does not list", async () => {
    const extra = "b".repeat(32)
    const hub = await startHub()
    const socket = await raw.connect({ port: hub.port, path: pair.SocketPath, origin: `chrome-extension://${extra}` })
    expect(socket.status).toBe(403)
    socket.close()
    await hub.stop()
  }, 10_000)
})
