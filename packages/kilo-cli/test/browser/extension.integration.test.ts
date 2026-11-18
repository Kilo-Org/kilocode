// The extension backend over a real loopback hub: the pairing POST a browser performs, the HMAC handshake, and a
// scripted extension answering session.open and tools.call. Nothing here is mocked between the backend and the hub.
import { afterEach, describe, expect, test } from "bun:test"
import { backend } from "@kilocode/kilo-plugin/browser/extension"
import { NeedsPermissionError, UnavailableError } from "@kilocode/kilo-plugin/browser/backend"
import { spawn, type ChildProcess } from "child_process"
import fs from "fs/promises"
import net from "node:net"
import os from "os"
import path from "path"
import { randomUUID } from "node:crypto"
import { create as createClient, HubError } from "../../src/browser/client"
import { encode } from "../../src/browser/frame"
import * as pair from "../../src/browser/pair"
import { hub } from "../../src/browser/port"
import * as proto from "../../src/browser/protocol"
import { Registry } from "../../src/browser/registry"
import { extensionHello, inbox, until } from "./fixture"
import * as raw from "./ws"

// The CLI entry from source, as `bun dev` runs it; the hub child is the real CLI.
const cli = path.join(import.meta.dir, "../../src/index.ts")

type Runtime = { root: string; run: string; data: string; port: number; child: ChildProcess; hubId: string; socket: string }

const running: Runtime[] = []
const sockets: raw.Socket[] = []

async function exited(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const done = Promise.withResolvers<void>()
  child.once("exit", () => done.resolve())
  const timer = setTimeout(() => child.kill("SIGKILL"), 5_000)
  timer.unref()
  await done.promise
  clearTimeout(timer)
}

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close()
  for (const runtime of running.splice(0)) {
    runtime.child.kill()
    await exited(runtime.child)
    await fs.rm(runtime.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})

async function free() {
  const server = net.createServer()
  const listening = Promise.withResolvers<number>()
  server.once("error", listening.reject)
  server.listen(0, "127.0.0.1", () => {
    const address = server.address()
    listening.resolve(typeof address === "object" && address !== null ? address.port : 0)
  })
  const value = await listening.promise
  const closed = Promise.withResolvers<void>()
  server.close(() => closed.resolve())
  await closed.promise
  return value
}

async function start(): Promise<Runtime> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-extension-"))
  const run = path.join(root, "run")
  const data = path.join(root, "browser")
  const port = await free()
  const child = spawn(
    process.execPath,
    ["--conditions=browser", cli, "browser", "hub", "--loopback", "--port", String(port)],
    {
      cwd: path.join(import.meta.dir, "../.."),
      env: {
        ...process.env,
        XDG_DATA_HOME: path.join(root, "share"),
        XDG_CONFIG_HOME: path.join(root, "config"),
        XDG_STATE_HOME: path.join(root, "state"),
        XDG_CACHE_HOME: path.join(root, "cache"),
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
  const runtime: Runtime = { root, run, data, port, child, hubId: "", socket: "" }
  running.push(runtime)
  const entry = await until(async () => (await Registry.list({ dir: path.join(run, "hubs") })).at(0), 10_000)
  runtime.hubId = entry.hubId
  runtime.socket = entry.socket
  return runtime
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`the hub sent invalid JSON: ${String(error)}`, { cause: error })
  }
}

async function message<T>(socket: raw.Socket, schema: { parse(value: unknown): T }) {
  return schema.parse(parse(await socket.take()))
}

/** Mints a pairing token the way the CLI does, over the per-user socket. */
async function mint(runtime: Runtime) {
  const socket = net.createConnection(runtime.socket)
  const connected = Promise.withResolvers<void>()
  socket.once("connect", connected.resolve)
  socket.once("error", connected.reject)
  await connected.promise
  const frames = inbox(socket)
  socket.write(encode({ type: "rpc", message: { jsonrpc: "2.0", id: 1, method: "pairing.url", params: {} } }))
  try {
    for (;;) {
      const frame = await frames.take(proto.HubToCli)
      // The hub reports its state first; only the rpc frame is the answer.
      if (frame.type !== "rpc" || !proto.isResponse(frame.message)) continue
      return proto.HubRequests["pairing.url"].result.parse(frame.message.result)
    }
  } finally {
    socket.destroy()
  }
}

/**
 * The whole pairing path a browser takes: redeem the token over an origin-bearing POST, then authenticate with it.
 * `profile` is the label the extension reports in `ext.hello`.
 */
async function pairExtension(runtime: Runtime, contractSha: string, profile = "Default") {
  const origin = `chrome-extension://${proto.StoreExtensionId}`
  const { url } = await mint(runtime)
  const token = new URLSearchParams(new URL(url).hash.slice(1)).get("t")
  expect(token).not.toBeNull()
  const response = await fetch(`http://127.0.0.1:${runtime.port}${pair.PairingKeyPath}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ t: token }),
  })
  expect(response.status).toBe(200)
  const body = pair.KeyExchange.parse(await response.json())

  const socket = await raw.connect({ port: runtime.port, path: pair.SocketPath, origin })
  sockets.push(socket)
  expect(socket.status).toBe(101)
  const challenge = await message(socket, proto.Challenge)
  const nonceE = pair.nonce()
  socket.send(
    JSON.stringify({
      type: "auth",
      hubId: runtime.hubId,
      nonceE,
      mac: pair.extensionMac(body.key, challenge.nonceH, nonceE),
    }),
  )
  const ok = await message(socket, proto.AuthOk)
  expect(ok.mac).toBe(pair.hubMac(body.key, challenge.nonceH, nonceE))
  expect(await message(socket, proto.HubHello)).toMatchObject({ type: "hub.hello", mode: "loopback" })
  socket.send(JSON.stringify(extensionHello({ profileLabel: profile, contractSha })))
  return socket
}

/**
 * Pairs, or undefined when the hub refused the attach. A refusal is not an error to assert on here: the hub holds one
 * extension at a time, so a real browser retries until the previous connection is gone.
 */
async function tryPair(runtime: Runtime, contractSha: string, profile: string) {
  try {
    return await pairExtension(runtime, contractSha, profile)
  } catch {
    return undefined
  }
}

type Call = { controllerId: string; id: string | number; method: string; params: Record<string, unknown> }

/** The next routed request the extension receives, skipping the hub's controller bookkeeping. */
async function request(socket: raw.Socket, method?: string): Promise<Call> {
  return until(async () => {
    const text = await socket.take(500).catch(() => undefined)
    if (text === undefined) return undefined
    const frame = proto.HubToExtension.safeParse(parse(text))
    if (!frame.success || frame.data.type !== "rpc") return undefined
    if (!proto.isRequest(frame.data.message)) return undefined
    if (method !== undefined && frame.data.message.method !== method) return undefined
    return {
      controllerId: frame.data.controllerId,
      id: frame.data.message.id,
      method: frame.data.message.method,
      params: (frame.data.message.params ?? {}) as Record<string, unknown>,
    }
  }, 5_000)
}

function answer(socket: raw.Socket, call: Call, result: unknown) {
  socket.send(
    JSON.stringify({ type: "rpc", controllerId: call.controllerId, message: { jsonrpc: "2.0", id: call.id, result } }),
  )
}

function refuse(socket: raw.Socket, call: Call, name: proto.ErrorName, message: string, data?: unknown) {
  socket.send(
    JSON.stringify({
      type: "rpc",
      controllerId: call.controllerId,
      message: proto.failure(call.id, name, message, data),
    }),
  )
}

const snapshot = (url: string, title: string) =>
  ["- Page URL: " + url, "- Page Title: " + title, "", "### Snapshot", "```yaml", '- button "Send"', "```"].join("\n")

describe("extension backend over a real hub", () => {
  test("pairs, opens a session, and round-trips navigate, snapshot and a permission ask", async () => {
    const runtime = await start()
    const connection = hub({
      dir: runtime.run,
      timeout: 5_000,
      version: "e2e",
      install: () => Promise.resolve(),
      // A test never opens a browser window: the pairing page has nowhere to go.
      opener: () => Promise.resolve(),
    })
    const active = backend({ port: connection.port(null), directory: "/tmp/kilo-extension-e2e" })
    const extension = await pairExtension(runtime, active.contractSha)

    const navigating = active.callTool("browser_navigate", { url: "http://localhost:3000" }, { session: "ses_e2e" })
    const opened = await request(extension, "session.open")
    expect(opened.params).toMatchObject({ sessionId: "ses_e2e", title: "ses_e2e", cwd: "/tmp/kilo-extension-e2e" })
    answer(extension, opened, { sessionHandle: randomUUID() })

    const navigate = await request(extension, "tools.call")
    expect(navigate.params).toMatchObject({ name: "browser_navigate", arguments: { url: "http://localhost:3000" } })
    answer(extension, navigate, {
      content: [{ type: "text", text: snapshot("http://localhost:3000", "Local") }],
      isError: false,
      _meta: { url: "http://localhost:3000", withheldFrames: [] },
    })
    const navigated = await navigating
    expect(navigated.isError).toBe(false)
    expect(navigated.content[0]).toEqual({
      type: "text",
      text: snapshot("http://localhost:3000", "Local"),
    })
    expect(navigated.meta?.url).toBe("http://localhost:3000")

    const reading = active.callTool("browser_snapshot", {}, { session: "ses_e2e" })
    const read = await request(extension, "tools.call")
    expect(read.params).toMatchObject({ name: "browser_snapshot" })
    answer(extension, read, { content: [{ type: "text", text: snapshot("http://localhost:3000", "After") }] })
    expect((await reading).content[0]).toEqual({ type: "text", text: snapshot("http://localhost:3000", "After") })

    // The extension refuses the click until the page's read grant is approved, then answers the retry.
    const clicking = active.callTool("browser_click", { target: "e1" }, { session: "ses_e2e" })
    const blocked = await request(extension, "tools.call")
    refuse(extension, blocked, "needs_permission", "Reading this page needs approval.", {
      items: [{ class: "read", origin: "https://example.com" }],
    })
    const error = await clicking.catch((value: unknown) => value)
    expect(error).toBeInstanceOf(NeedsPermissionError)
    expect((error as NeedsPermissionError).items).toEqual([{ class: "read", origin: "https://example.com" }])

    const retrying = active.callTool(
      "browser_click",
      { target: "e1" },
      { session: "ses_e2e", authorized: ["read:https://example.com"] },
    )
    const retried = await request(extension, "tools.call")
    expect(retried.params.authorized).toEqual([{ class: "read", origin: "https://example.com" }])
    answer(extension, retried, { content: [{ type: "text", text: snapshot("https://example.com", "Example") }] })
    expect((await retrying).isError).toBe(false)
  }, 30_000)

  test("a selected profile drops the link when the extension comes back as another profile", async () => {
    const runtime = await start()
    const extension = await pairExtension(runtime, "deadbeef", "Default")
    const client = createClient({ dir: runtime.run, profile: "Default", start: () => {}, timeout: 2_000 })
    try {
      expect((await client.ready(3_000)).profileLabel).toBe("Default")

      // The hub answers a *fully authenticated* second extension with 4403 while the first one holds it: the key is
      // the one the hub stored, so the handshake itself succeeds and the refusal is the attach, not a bad MAC.
      const refused = await raw.connect({
        port: runtime.port,
        path: pair.SocketPath,
        origin: `chrome-extension://${proto.StoreExtensionId}`,
      })
      sockets.push(refused)
      expect(refused.status).toBe(101)
      const challenge = await message(refused, proto.Challenge)
      const nonceE = pair.nonce()
      const key = await pair.load(path.join(runtime.data, "pairing.json"))
      refused.send(
        JSON.stringify({
          type: "auth",
          hubId: runtime.hubId,
          nonceE,
          mac: pair.extensionMac(key, challenge.nonceH, nonceE),
        }),
      )
      // Authenticated, then refused at the attach: no hub.hello, and the socket closes with 4403.
      expect(await message(refused, proto.HubHello).catch(() => undefined)).toBeUndefined()
      expect(await refused.closed).toBe(4403)
      const held = await until(async () => (await Registry.list({ dir: path.join(runtime.run, "hubs") })).at(0), 5_000)
      expect(held?.profileLabel).toBe("Default")

      extension.close()
      sockets.splice(sockets.indexOf(extension), 1)
      // A real browser retries: the hub releases the slot once the old socket is gone.
      const second = await until(() => tryPair(runtime, "deadbeef", "Work"), 5_000)
      expect(second?.status).toBe(101)

      // The client refuses it: the link drops, a rediscovery is scheduled, and a call fails closed.
      await until(() => (client.state().kind === "reconnecting" ? true : undefined), 5_000)
      const call = await client.tools.list().catch((value: unknown) => value)
      expect(call).toBeInstanceOf(HubError)
      expect((call as HubError).code).toBe(proto.ErrorCodes.browser_unavailable)
    } finally {
      client.close()
    }
  }, 30_000)

  test("a disconnect in the middle of a call fails it as uncertain and never replays it", async () => {
    const runtime = await start()
    const connection = hub({
      dir: runtime.run,
      timeout: 5_000,
      version: "e2e",
      install: () => Promise.resolve(),
      // A test never opens a browser window: the pairing page has nowhere to go.
      opener: () => Promise.resolve(),
    })
    const active = backend({ port: connection.port(null), directory: "/tmp/kilo-extension-e2e" })
    const extension = await pairExtension(runtime, active.contractSha)

    const clicking = active.callTool("browser_click", { target: "e1" }, { session: "ses_drop" })
    const opened = await request(extension, "session.open")
    answer(extension, opened, { sessionHandle: randomUUID() })
    // The extension takes the call and the browser goes away before it answers.
    await request(extension, "tools.call")
    extension.close()

    const error = await clicking.catch((value: unknown) => value)
    expect(error).toBeInstanceOf(UnavailableError)
    expect((error as UnavailableError).effectsUncertain).toBe(true)

    // No replay: after the drop the same call is made again, and the hub refuses it with no extension attached.
    const again = await active
      .callTool("browser_click", { target: "e1" }, { session: "ses_drop" })
      .catch((value: unknown) => value)
    expect(again).toBeInstanceOf(UnavailableError)
  }, 30_000)
})
