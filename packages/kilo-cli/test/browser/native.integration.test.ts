// The real hub process, started the way the browser starts it, with a fake extension
// on stdio and two CLI clients on the per-user socket.
import { afterEach, describe, expect, test } from "bun:test"
import { spawn, type ChildProcess } from "child_process"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { HubError, create as createClient, type Client } from "../../src/browser/client"
import { encode } from "../../src/browser/frame"
import * as proto from "../../src/browser/protocol"
import { Registry } from "../../src/browser/registry"
import { extensionHello, inbox, until, type Inbox } from "./fixture"

// The CLI entry from source, as `bun dev` runs it; the hub child is the real CLI.
const entry = path.join(import.meta.dir, "../../src/index.ts")

type Runtime = {
  root: string
  run: string
  child: ChildProcess
  frames: Inbox
  send(frame: unknown): void
}

const running: Runtime[] = []
const clients: Client[] = []

afterEach(async () => {
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

async function start(): Promise<Runtime> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-native-"))
  const run = path.join(root, "run")
  const child = spawn(process.execPath, ["--conditions=browser", entry, "browser", "hub", "--native"], {
    cwd: path.join(import.meta.dir, "../.."),
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
      KILO_BROWSER_DATA_DIR: path.join(root, "share", "browser"),
    },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  })
  if (!child.stdout || !child.stdin) throw new Error("the hub process has no stdio")
  const stdin = child.stdin
  const runtime: Runtime = {
    root,
    run,
    child,
    frames: inbox(child.stdout),
    send: (frame) => stdin.write(encode(frame)),
  }
  running.push(runtime)
  return runtime
}

function client(run: string) {
  const created = createClient({ dir: run, timeout: 3_000, start: () => {} })
  clients.push(created)
  return created
}

async function routed(hub: Runtime, method: string) {
  const frame = await until(async () => {
    const value = await hub.frames.take(proto.HubToExtension, 500).catch(() => undefined)
    if (value === undefined) return undefined
    if (value.type !== "rpc" || !proto.isRequest(value.message)) return undefined
    return value.message.method === method ? value : undefined
  }, 5_000)
  return frame
}

describe("native hub process", () => {
  test("routes calls from two CLI clients without crossing them", async () => {
    const hub = await start()
    expect(await hub.frames.take(proto.HubHello)).toMatchObject({
      type: "hub.hello",
      protocol: [1],
      mode: "native",
    })

    const entry = await until(async () => (await Registry.list({ dir: path.join(hub.run, "hubs") })).at(0))
    expect(entry.mode).toBe("native")
    // The advertised transport is the platform's: a named pipe on Windows, a unix
    // socket elsewhere.
    expect(entry.socket.startsWith("\\\\.\\pipe\\kilo-browser-")).toBe(process.platform === "win32")
    expect(entry.socket.endsWith(".sock")).toBe(process.platform !== "win32")

    hub.send(extensionHello({ profileLabel: "Work" }))

    const a = client(hub.run)
    expect((await a.ready(5_000)).profileLabel).toBe("Work")
    const joinedA = await hub.frames.take(proto.ControllerConnected)

    // A's call reaches the fake extension under A's own controller id.
    const listed = a.tools.list()
    const callA = await routed(hub, "tools.list")
    if (callA.type !== "rpc" || !proto.isRequest(callA.message)) throw new Error("expected a routed call")
    expect(callA.controllerId).toBe(joinedA.controllerId)
    hub.send({
      type: "rpc",
      controllerId: callA.controllerId,
      message: { jsonrpc: "2.0", id: callA.message.id, result: { contractSha: "abc", tools: [] } },
    })
    expect(await listed).toStrictEqual({ contractSha: "abc", tools: [] })

    // A second client gets its own controller id and its own answer.
    const b = client(hub.run)
    expect((await b.ready(5_000)).profileLabel).toBe("Work")
    const joinedB = await hub.frames.take(proto.ControllerConnected)
    expect(joinedB.controllerId).not.toBe(joinedA.controllerId)

    const listedB = b.tools.list()
    const callB = await routed(hub, "tools.list")
    if (callB.type !== "rpc" || !proto.isRequest(callB.message)) throw new Error("expected a routed call")
    expect(callB.controllerId).toBe(joinedB.controllerId)
    hub.send({
      type: "rpc",
      controllerId: callB.controllerId,
      message: { jsonrpc: "2.0", id: callB.message.id, result: { contractSha: "def", tools: [] } },
    })
    expect(await listedB).toStrictEqual({ contractSha: "def", tools: [] })

    // Notifications follow the same routing: B's handler receives it. A's handler
    // staying quiet is proven directly by the hub unit test.
    const seen = { a: 0, b: 0 }
    a.on("tab.closed", () => {
      seen.a += 1
    })
    const delivered = Promise.withResolvers<void>()
    b.on("tab.closed", () => {
      seen.b += 1
      delivered.resolve()
    })
    hub.send({
      type: "rpc",
      controllerId: joinedB.controllerId,
      message: { jsonrpc: "2.0", method: "tab.closed", params: { sessionHandle: "s", tabId: 5 } },
    })
    await delivered.promise
    expect(seen).toStrictEqual({ a: 0, b: 1 })

    // A response for a request nobody made is dropped and the next call still works.
    hub.send({
      type: "rpc",
      controllerId: joinedA.controllerId,
      message: { jsonrpc: "2.0", id: 9_999, result: { contractSha: "stale", tools: [] } },
    })
    const again = a.tools.list()
    const callAgain = await routed(hub, "tools.list")
    if (callAgain.type !== "rpc" || !proto.isRequest(callAgain.message)) throw new Error("expected a routed call")
    hub.send({
      type: "rpc",
      controllerId: callAgain.controllerId,
      message: { jsonrpc: "2.0", id: callAgain.message.id, result: { contractSha: "abc", tools: [] } },
    })
    expect(await again).toStrictEqual({ contractSha: "abc", tools: [] })

    // Closing a client tells the extension that its controller is gone.
    a.close()
    const left = await until(async () => {
      const value = await hub.frames.take(proto.HubToExtension, 500).catch(() => undefined)
      return value?.type === "controller.disconnected" ? value : undefined
    }, 5_000)
    expect(left.controllerId).toBe(joinedA.controllerId)
  })

  test("tells a client that the browser is not available before the extension connects", async () => {
    const hub = await start()
    await hub.frames.take(proto.HubHello)
    await until(async () => (await Registry.list({ dir: path.join(hub.run, "hubs") })).at(0))

    const a = client(hub.run)
    const states: string[] = []
    a.subscribe((state) => states.push(state.kind))
    await until(() => (states.includes("waiting") ? true : undefined))

    const failure = await a.tools.list().then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(HubError)
    if (!(failure instanceof HubError)) throw new Error("expected a HubError")
    expect(failure.kind).toBe("browser_unavailable")
  })
})
