// The CLI client against an in-process hub: discovery, pairing, and the reconnect
// lifecycle, without a browser.
import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { randomUUID } from "node:crypto"
import { create as createClient, type Client, type State } from "../../../src/kilocode/browser/client"
import { create as createHub, type Hub } from "../../../src/kilocode/browser/hub"
import * as proto from "../../../src/kilocode/browser/protocol"
import { Registry } from "../../../src/kilocode/browser/registry"
import { serve } from "../../../src/kilocode/browser/socket"

const cleanups: (() => Promise<void> | void)[] = []
const restore: (() => void)[] = []

afterEach(async () => {
  for (const item of cleanups.splice(0).reverse()) await item()
  for (const undo of restore.splice(0)) undo()
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
  // The client reads the pairing key to build the page URL, so keep it out of the
  // real data directory.
  const before = process.env.KILO_BROWSER_DATA_DIR
  process.env.KILO_BROWSER_DATA_DIR = path.join(root, "data")
  restore.push(() => {
    if (before === undefined) delete process.env.KILO_BROWSER_DATA_DIR
    else process.env.KILO_BROWSER_DATA_DIR = before
  })
  const dir = path.join(root, "run")
  await fs.mkdir(dir, { recursive: true })
  return { root, dir, hubs: path.join(dir, "hubs") }
}

function socketPath(root: string) {
  return process.platform === "win32" ? `\\\\.\\pipe\\kilo-client-${randomUUID()}` : path.join(root, "h.sock")
}

async function host(input: { root: string; hubs: string; paired?: boolean }) {
  const hub = createHub({ mode: "loopback", version: "test" })
  const server = await serve({
    path: socketPath(input.root),
    open(connection) {
      const controller = hub.join(
        (frame) => connection.send(frame),
        () => connection.close(),
      )
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
  return { hub, entry }
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
    expect(new URLSearchParams(page.hash.slice(1)).get("k")).toBeDefined()

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
    const target = client({
      dir: at.dir,
      start: () => {
        throw new Error("cannot spawn")
      },
    })

    await until(target, "reconnecting")
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
