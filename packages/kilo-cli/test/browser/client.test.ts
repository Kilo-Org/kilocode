// The CLI client against an in-process hub: discovery, pairing, and the reconnect
// lifecycle, without a browser.
import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { randomUUID } from "node:crypto"
import { HubError, create as createClient, type Client, type State } from "../../src/browser/client"
import { create as createHub, type Hub } from "../../src/browser/hub"
import * as pair from "../../src/browser/pair"
import * as proto from "../../src/browser/protocol"
import { Registry } from "../../src/browser/registry"
import { serve } from "../../src/browser/socket"
import { until as eventually } from "./fixture"

const cleanups: (() => Promise<void> | void)[] = []

afterEach(async () => {
  for (const item of cleanups.splice(0).reverse()) await item()
})

const info: proto.ExtensionInfo = {
  protocol: [1],
  extensionVersion: "1.0.0",
  browser: { name: "Chrome", version: "140" },
  profileLabel: "Default",
  contractSha: "abc",
  capabilities: {
    trustedInput: true,
    console: true,
    network: true,
    dialogs: true,
    fileUpload: true,
    tabGroups: true,
  },
}

// Unix socket paths are capped near 100 bytes, so the temp root is short there. On
// Windows the hub uses a named pipe and the directory length does not matter.
async function tmp() {
  const base = process.platform === "win32" ? os.tmpdir() : "/tmp"
  const root = await fs.mkdtemp(path.join(base, "kilo-client-"))
  cleanups.push(() => fs.rm(root, { recursive: true, force: true }))
  const dir = path.join(root, "run")
  await fs.mkdir(dir, { recursive: true })
  return { root, dir, hubs: path.join(dir, "hubs") }
}

function socketPath(root: string) {
  return process.platform === "win32" ? `\\\\.\\pipe\\kilo-client-${randomUUID()}` : path.join(root, "h.sock")
}

async function host(input: { root: string; hubs: string; paired?: boolean }) {
  // The pairing ask is answered by the hub over this socket, exactly as loopback.ts
  // wires it; the URL carries a single-use token, never the key.
  const hub: Hub = createHub({
    mode: "loopback",
    version: "test",
    local: (method) =>
      method === "pairing.url" ? { url: pair.url({ port: 47917, hubId: hub.id, token: "test-token" }) } : undefined,
  })
  // The controller ids the hub assigns, in connection order, so a test can route an
  // extension frame to a specific CLI.
  const controllers: string[] = []
  const server = await serve({
    path: socketPath(input.root),
    open(connection) {
      const controller = hub.join(
        (frame) => connection.send(frame),
        () => connection.close(),
      )
      controllers.push(controller.id)
      connection.onClose(() => controller.drop())
      return (frame) => controller.frame(frame)
    },
  })
  cleanups.push(() => server.close())
  const entry = Registry.Entry.parse({
    ...Registry.empty({ hubId: hub.id, mode: "loopback", socket: server.path }),
    port: 47917,
    paired: input.paired ?? false,
  })
  await Registry.write(entry, input.hubs)
  return { hub, entry, controllers }
}

// Resolves on the next state change to `kind`; no polling, and the timer only runs
// while the condition is not yet observable.
function until(client: Client, kind: State["kind"], timeout = 5_000) {
  const deferred = Promise.withResolvers<State>()
  const off = client.subscribe((state) => {
    if (state.kind !== kind) return
    off()
    deferred.resolve(state)
  })
  const current = client.state()
  if (current.kind === kind) {
    off()
    deferred.resolve(current)
  }
  const timer = setTimeout(() => {
    off()
    deferred.reject(new Error(`state "${kind}" not reached; the client is ${client.state().kind}`))
  }, timeout)
  return deferred.promise.finally(() => clearTimeout(timer))
}

function client(input: Parameters<typeof createClient>[0]) {
  const created = createClient(input)
  cleanups.push(() => created.close())
  return created
}

describe("browser client", () => {
  test("opens the pairing page once for a hub that was never paired", async () => {
    const at = await tmp()
    const { hub } = await host(at)
    const opened = Promise.withResolvers<string>()
    let calls = 0
    const target = client({
      dir: at.dir,
      start: () => {},
      opener: async (url) => {
        calls += 1
        opened.resolve(url)
      },
    })

    const page = new URL(await opened.promise)
    expect(page.host).toBe("127.0.0.1:47917")
    expect(page.pathname).toBe("/__kilo_browser_pair")
    // The opener's argv is world-readable on Linux, so the URL the CLI hands it
    // carries a single-use token and never the durable pairing key.
    const fragment = new URLSearchParams(page.hash.slice(1))
    expect(fragment.get("t")).toBe("test-token")
    expect(fragment.get("k")).toBeNull()

    // An extension that attaches and drops makes the hub report waiting again; the
    // page must not be reopened for the same hub start. The short wait is the only
    // way to observe that the second wait did not open anything.
    await until(target, "waiting")
    const extension = hub.attach(
      () => true,
      () => undefined,
    )!
    extension.hello(info)
    extension.drop()
    await Bun.sleep(200)
    expect(calls).toBe(1)
  })

  test("keeps reading after a notification named like an Object.prototype member", async () => {
    const at = await tmp()
    const { hub, controllers } = await host({ ...at, paired: true })
    const target = client({ dir: at.dir, start: () => {} })
    await until(target, "waiting")
    const extension = hub.attach(
      () => true,
      () => undefined,
    )!
    extension.hello(info)
    await until(target, "ready")
    const controllerId = controllers[0]!
    const seen: number[] = []
    target.on("tab.closed", (params) => seen.push(params.tabId))

    // The extension picks the method name. A plain-object lookup finds an inherited
    // Object.prototype member for each of these instead of undefined, and the
    // resulting throw escapes this reader and drops every frame behind it.
    for (const method of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      extension.frame({ type: "rpc", controllerId, message: { jsonrpc: "2.0", method, params: {} } })
    }

    // A real notification still reaches its handler, so the connection is alive and
    // dispatch was not disturbed.
    extension.frame({
      type: "rpc",
      controllerId,
      message: { jsonrpc: "2.0", method: "tab.closed", params: { sessionHandle: "s", tabId: 7 } },
    })
    await eventually(() => (seen.length === 1 ? true : undefined))
    expect(seen).toStrictEqual([7])
    expect(target.state().kind).toBe("ready")
  })

  test("fails an in-flight request when the extension goes away", async () => {
    const at = await tmp()
    const { hub } = await host({ ...at, paired: true })
    const target = client({ dir: at.dir, start: () => {} })
    await until(target, "waiting")
    const routed: proto.HubToExtension[] = []
    const extension = hub.attach(
      (frame) => {
        routed.push(frame)
        return true
      },
      () => undefined,
    )!
    extension.hello(info)
    await until(target, "ready")

    // The hub routes the call and nothing ever answers it.
    const pending = target.tools.list().then(
      () => undefined,
      (error: unknown) => error,
    )
    await eventually(() => (routed.some((frame) => frame.type === "rpc") ? true : undefined))
    extension.drop()

    const failure = await pending
    expect(failure).toBeInstanceOf(HubError)
    if (!(failure instanceof HubError)) throw new Error("expected a HubError")
    expect(failure.kind).toBe("browser_unavailable")
    // The call may have reached the browser before the transport went away, so the
    // caller must look at the page rather than retry blind.
    expect(failure.uncertain).toBe(true)
    expect(target.state().kind).toBe("waiting")
  })

  test("does not open the pairing page for a hub that already paired", async () => {
    const at = await tmp()
    await host({ ...at, paired: true })
    const opened: string[] = []
    const target = client({
      dir: at.dir,
      start: () => {},
      opener: async (url) => {
        opened.push(url)
      },
    })

    await until(target, "waiting")
    // Absence again: give the opener's file read time to resolve before asserting.
    await Bun.sleep(100)
    expect(opened).toStrictEqual([])
  })

  test("a failed start leaves the client retrying instead of stalling", async () => {
    const at = await tmp()
    let starts = 0
    const target = client({
      dir: at.dir,
      start: () => {
        starts += 1
        throw new Error("cannot spawn")
      },
    })

    await until(target, "reconnecting")
    // A transient host failure must not disable self-start for good: the next
    // attempt runs the hook again instead of only polling an empty registry.
    await eventually(() => (starts >= 2 ? true : undefined))
    expect(starts).toBeGreaterThanOrEqual(2)
  })

  test("a hub process that exits before registering is treated as a failed start", async () => {
    const at = await tmp()
    const script = path.join(at.root, "exit.ts")
    await fs.writeFile(script, "process.exit(1)\n")
    const target = client({ dir: at.dir, command: [process.execPath, script] })

    // Without the exit handler this would stay in `connecting` for the 8 s registry
    // window and then report "no hub is reachable".
    const state = await until(target, "reconnecting")
    expect(state).toMatchObject({ kind: "reconnecting", reason: "cannot start the browser hub" })
  })

  test("a hub child that outlives the attempt still resets the self-start guard", async () => {
    const at = await tmp()
    // One spawn per run, recorded so the test can count them; the child outlives the
    // attempt that started it and exits afterwards.
    const script = path.join(at.root, "slow.cjs")
    const spawns = path.join(at.root, "spawns")
    await fs.writeFile(
      script,
      `const fs = require("node:fs")\nfs.appendFileSync(${JSON.stringify(spawns)}, "x")\nsetTimeout(() => process.exit(1), 400)\n`,
    )
    // An entry whose socket refuses ends the first attempt as "no hub is reachable"
    // while the child is still alive, so no socket close can drive the next attempt.
    const dead = Registry.Entry.parse({
      ...Registry.empty({ hubId: randomUUID(), mode: "loopback", socket: path.join(at.root, "missing.sock") }),
      pid: process.pid,
    })
    await Registry.write(dead, at.hubs)
    client({ dir: at.dir, command: [process.execPath, script] })

    // The late exit has to clear `tried`; otherwise every retry skips start() and the
    // second spawn never happens.
    await eventually(async () => {
      const text = await fs.readFile(spawns, "utf8").catch(() => "")
      return text.length >= 2 ? true : undefined
    }, 5_000)
  })

  test("close() stops a connect that is still waiting for a hub", async () => {
    const at = await tmp()
    const target = client({ dir: at.dir, start: () => {} })

    await until(target, "connecting")
    target.close("the test closed the client")
    // A hub that appears after close() must not be dialed or resurrect the client.
    await host(at)
    await Bun.sleep(400)
    expect(target.state()).toStrictEqual({ kind: "closed", reason: "the test closed the client" })
  })

  test("allows a fresh self-start once a hub has answered", async () => {
    const at = await tmp()
    let starts = 0
    const first = Promise.withResolvers<void>()
    const again = Promise.withResolvers<void>()
    const target = client({
      dir: at.dir,
      start: () => {
        starts += 1
        first.resolve()
        if (starts >= 2) again.resolve()
      },
    })

    // The first attempt has no hub, so it starts one and waits for the registry.
    await first.promise
    const { hub, entry } = await host(at)
    await until(target, "waiting")

    // The hub goes away completely; the next attempt has to start one again.
    await Registry.remove(entry.hubId, at.hubs)
    const next = until(target, "connecting")
    hub.close("the test stopped the hub")
    await next
    await again.promise
    expect(starts).toBe(2)
  })
})
