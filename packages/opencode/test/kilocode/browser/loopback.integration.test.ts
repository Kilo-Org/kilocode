// The real loopback hub process, with a fake extension doing the pairing handshake
// over a WebSocket and two CLI clients on the socket.
import { afterEach, describe, expect, test } from "bun:test"
import { spawn, type ChildProcess } from "child_process"
import fs from "fs/promises"
import net from "node:net"
import os from "os"
import path from "path"
import z from "zod"
import { create as createClient, type Client } from "../../../src/kilocode/browser/client"
import * as pair from "../../../src/kilocode/browser/pair"
import * as proto from "../../../src/kilocode/browser/protocol"
import { Registry } from "../../../src/kilocode/browser/registry"
import { extensionHello, until } from "./fixture"
import * as raw from "./ws"

type Runtime = {
  root: string
  run: string
  data: string
  port: number
  child: ChildProcess
  hubId: string
  key: string
}

const running: Runtime[] = []
const clients: Client[] = []
const sockets: raw.Socket[] = []

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close()
  for (const client of clients.splice(0)) client.close()
  for (const runtime of running.splice(0)) {
    runtime.child.kill()
    await new Promise<void>((resolve) => {
      if (runtime.child.exitCode !== null) return resolve()
      runtime.child.once("exit", () => resolve())
    })
    await fs.rm(runtime.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})

async function port() {
  const server = net.createServer()
  const listening = Promise.withResolvers<number>()
  server.once("error", listening.reject)
  server.listen(0, "127.0.0.1", () => {
    const address = server.address()
    listening.resolve(typeof address === "object" && address !== null ? address.port : 0)
  })
  const free = await listening.promise
  const closed = Promise.withResolvers<void>()
  server.close(() => closed.resolve())
  await closed.promise
  return free
}

async function start(): Promise<Runtime> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-loopback-"))
  const run = path.join(root, "run")
  const data = path.join(root, "browser")
  const free = await port()
  const child = spawn(
    process.execPath,
    [
      "--conditions=browser",
      path.join(process.cwd(), "src/index.ts"),
      "browser-hub",
      "--loopback",
      "--port",
      String(free),
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        XDG_DATA_HOME: path.join(root, "share"),
        XDG_CONFIG_HOME: path.join(root, "config"),
        XDG_STATE_HOME: path.join(root, "state"),
        XDG_CACHE_HOME: path.join(root, "cache"),
        KILO_CONFIG_CONTENT: '{"experimental":{"openTelemetry":false}}',
        KILO_DISABLE_PROJECT_CONFIG: "1",
        KILO_DISABLE_AUTOUPDATE: "1",
        KILO_DISABLE_MODELS_FETCH: "1",
        KILO_AUTH_CONTENT: "{}",
        KILO_PURE: "1",
        KILO_BROWSER_RUN_DIR: run,
        KILO_BROWSER_DATA_DIR: data,
      },
      stdio: "ignore",
      windowsHide: true,
    },
  )
  const entry = await until(async () => (await Registry.list({ dir: path.join(run, "hubs") })).at(0), 10_000)
  const file = path.join(data, "pairing.json")
  const stat = await fs.stat(file)
  expect(stat.isFile()).toBe(true)
  // Windows reports 0666 for every file; 0600 is a POSIX guarantee.
  if (process.platform !== "win32") expect(stat.mode & 0o777).toBe(0o600)
  const key = await pair.load(file)
  // The hub advertises the platform's socket: a named pipe on Windows, a unix socket
  // elsewhere, so the CLI client dials the same transport the hub listens on.
  expect(entry.socket.startsWith("\\\\.\\pipe\\kilo-browser-")).toBe(process.platform === "win32")
  expect(entry.socket.endsWith(".sock")).toBe(process.platform !== "win32")
  const runtime: Runtime = { root, run, data, port: free, child, hubId: entry.hubId, key }
  running.push(runtime)
  return runtime
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`the hub sent invalid JSON: ${String(error)}`, { cause: error })
  }
}

async function message<T>(socket: raw.Socket, schema: z.ZodType<T>) {
  return schema.parse(parse(await socket.take()))
}

async function dial(runtime: Runtime, origin?: string) {
  const socket = await raw.connect({
    port: runtime.port,
    path: pair.SocketPath,
    origin: origin ?? `chrome-extension://${proto.StoreExtensionId}`,
  })
  sockets.push(socket)
  return socket
}

// Runs the handshake the extension performs and leaves the socket attached.
async function handshake(runtime: Runtime) {
  const socket = await dial(runtime)
  expect(socket.status).toBe(101)
  const challenge = await message(socket, proto.Challenge)
  expect(pair.decode(challenge.nonceH, pair.NonceBytes)).toBeDefined()
  const nonceE = pair.nonce()
  socket.send(
    JSON.stringify({
      type: "auth",
      hubId: runtime.hubId,
      nonceE,
      mac: pair.extensionMac(runtime.key, challenge.nonceH, nonceE),
    }),
  )
  const ok = await message(socket, proto.AuthOk)
  expect(ok.mac).toBe(pair.hubMac(runtime.key, challenge.nonceH, nonceE))
  expect(await message(socket, proto.HubHello)).toMatchObject({ type: "hub.hello", mode: "loopback", protocol: [1] })
  return { socket, challenge, nonceE }
}

function client(run: string) {
  const created = createClient({ dir: run, timeout: 3_000, start: () => {} })
  clients.push(created)
  return created
}

async function routed(socket: raw.Socket, method: string) {
  return until(async () => {
    const text = await socket.take(500).catch(() => undefined)
    if (text === undefined) return undefined
    const value = proto.HubToExtension.safeParse(parse(text))
    if (!value.success || value.data.type !== "rpc" || !proto.isRequest(value.data.message)) return undefined
    return value.data.message.method === method ? value.data : undefined
  }, 5_000)
}

describe("loopback hub process", () => {
  test("pairs, routes two CLI clients, and refuses a second extension", async () => {
    const runtime = await start()

    // The pairing page says what is happening; everything else is not found.
    const page = await fetch(`http://127.0.0.1:${runtime.port}${pair.PairingPath}`)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain("Pairing")
    expect((await fetch(`http://127.0.0.1:${runtime.port}/nope`)).status).toBe(404)

    const extension = await handshake(runtime)
    extension.socket.send(JSON.stringify(extensionHello({ profileLabel: "Loopback" })))

    const a = client(runtime.run)
    expect((await a.ready(5_000)).profileLabel).toBe("Loopback")
    const joinedA = await message(extension.socket, proto.ControllerConnected)

    const listed = a.tools.list()
    const call = await routed(extension.socket, "tools.list")
    if (!proto.isRequest(call.message)) throw new Error("expected a routed call")
    expect(call.controllerId).toBe(joinedA.controllerId)
    extension.socket.send(
      JSON.stringify({
        type: "rpc",
        controllerId: call.controllerId,
        message: { jsonrpc: "2.0", id: call.message.id, result: { contractSha: "loop", tools: [] } },
      }),
    )
    expect(await listed).toStrictEqual({ contractSha: "loop", tools: [] })

    const b = client(runtime.run)
    await b.ready(5_000)
    const joinedB = await message(extension.socket, proto.ControllerConnected)
    expect(joinedB.controllerId).not.toBe(joinedA.controllerId)

    const delivered = Promise.withResolvers<void>()
    b.on("session.revoked", (params) => {
      expect(params.reason).toBe("user_stop")
      delivered.resolve()
    })
    extension.socket.send(
      JSON.stringify({
        type: "rpc",
        controllerId: joinedB.controllerId,
        message: { jsonrpc: "2.0", method: "session.revoked", params: { sessionHandle: "s", reason: "user_stop" } },
      }),
    )
    await delivered.promise

    // A second extension cannot take over the first one's sessions.
    const second = await dial(runtime)
    const challenge = await message(second, proto.Challenge)
    const nonceE = pair.nonce()
    second.send(
      JSON.stringify({
        type: "auth",
        hubId: runtime.hubId,
        nonceE,
        mac: pair.extensionMac(runtime.key, challenge.nonceH, nonceE),
      }),
    )
    await message(second, proto.AuthOk)
    await message(second, proto.HubHello)
    second.send(JSON.stringify(extensionHello()))
    expect(await second.closed).toBe(4403)
  }, 30_000)

  test("refuses a non-loopback or missing origin", async () => {
    const runtime = await start()
    expect((await dial(runtime, "https://example.com")).status).toBe(403)
    const socket = await raw.connect({ port: runtime.port, path: pair.SocketPath })
    sockets.push(socket)
    expect(socket.status).toBe(403)
  }, 30_000)

  test("refuses a bad MAC", async () => {
    const runtime = await start()
    const socket = await dial(runtime)
    const challenge = await message(socket, proto.Challenge)
    socket.send(
      JSON.stringify({
        type: "auth",
        hubId: runtime.hubId,
        nonceE: pair.nonce(),
        mac: pair.hubMac(runtime.key, challenge.nonceH, pair.nonce()),
      }),
    )
    expect(await socket.closed).toBe(4401)
  }, 30_000)
})
