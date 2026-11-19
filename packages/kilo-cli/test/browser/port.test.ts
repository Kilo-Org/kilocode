import { afterEach, describe, expect, setSystemTime, test } from "bun:test"
import { BrowserHub } from "@kilocode/kilo-plugin/browser/hub"
import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { HubError, create as createClient, type State } from "../../src/browser/client"
import { create as createHub } from "../../src/browser/hub"
import * as pair from "../../src/browser/pair"
import * as proto from "../../src/browser/protocol"
import { Registry } from "../../src/browser/registry"
import { serve } from "../../src/browser/socket"
import { absence, adoption, failure, hub as connection } from "../../src/browser/port"
import { extensionHello, until } from "./fixture"

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const item of cleanups.splice(0).reverse()) await item()
})

const codes = Object.fromEntries(
  (Object.keys(proto.ErrorCodes) as proto.ErrorName[]).map((name) => [name, proto.ErrorCodes[name]]),
) as Record<proto.ErrorName, number>

function hub(name: proto.ErrorName, data?: unknown) {
  return new HubError({ code: codes[name], message: `${name} happened`, ...(data === undefined ? {} : { data }) })
}

describe("hub failures as the extension backend reads them", () => {
  test("every protocol error becomes its own kind", () => {
    expect(failure(hub("browser_unavailable")).kind).toBe("unavailable")
    expect(failure(hub("tab_busy")).kind).toBe("busy")
    expect(failure(hub("tab_taken")).kind).toBe("taken")
    expect(failure(hub("user_stopped")).kind).toBe("stopped")
    expect(failure(hub("unsupported_in_browser")).kind).toBe("unsupported")
    expect(failure(hub("blocked")).kind).toBe("blocked")
    expect(failure(hub("protocol_mismatch")).kind).toBe("mismatch")
    expect(failure(hub("needs_permission")).kind).toBe("permission")
    expect(failure(hub("origin_changed")).kind).toBe("moved")
  })

  test("a dropped connection keeps its uncertainty marker", () => {
    const dropped = new HubError({
      code: proto.ErrorCodes.browser_unavailable,
      message: "The browser connection dropped: the hub closed the connection",
      data: { effectsUncertain: true },
    })
    expect(failure(dropped)).toMatchObject({ kind: "unavailable", uncertain: true })
  })

  test("a permission error carries its items, step token and post-action marker", () => {
    const mapped = failure(
      hub("needs_permission", {
        items: [{ class: "sensitive", origin: "https://example.com", reason: "password field" }],
        stepToken: "token",
        afterAction: true,
        url: "https://example.com",
      }),
    )
    expect(mapped).toMatchObject({
      kind: "permission",
      afterAction: true,
      stepToken: "token",
      items: [{ class: "sensitive", origin: "https://example.com", reason: "password field" }],
      meta: { url: "https://example.com" },
    })
  })

  test("a redirect names the origin it landed on, so the retry asks for the right read", () => {
    expect(
      failure(hub("origin_changed", { from: "https://a.example.com", to: "https://b.example.com/login" })),
    ).toMatchObject({
      kind: "moved",
      items: [{ class: "read", origin: "https://b.example.com" }],
    })
    // A destination that is not an http(s) origin cannot be granted, so it asks for nothing.
    expect(failure(hub("origin_changed", { from: "https://a.example.com", to: "about:blank" })).items).toEqual([])
  })

  test("a late need names the step its token was issued for", () => {
    const mapped = failure(
      hub("needs_permission", {
        items: [{ class: "sensitive", origin: "https://example.com", reason: "download: report.pdf" }],
        stepToken: "tok",
        afterAction: true,
        step: { tool: "browser_click", argumentsHash: "b1391036:15" },
      }),
    )
    expect(mapped).toMatchObject({
      kind: "permission",
      stepToken: "tok",
      step: { tool: "browser_click", argumentsHash: "b1391036:15" },
    })
    // An older extension names no step, and the carrying call is used instead.
    expect(failure(hub("needs_permission", { items: [] })).step).toBeUndefined()
  })

  test("a malformed step is dropped on its own, keeping the need's items and token", () => {
    const mapped = failure(
      hub("needs_permission", {
        items: [{ class: "sensitive", origin: "https://example.com", reason: "download: report.pdf" }],
        stepToken: "tok",
        afterAction: true,
        step: "browser_click",
      }),
    )
    expect(mapped).toMatchObject({
      kind: "permission",
      stepToken: "tok",
      items: [{ class: "sensitive", origin: "https://example.com", reason: "download: report.pdf" }],
    })
    // The step is gone, so the carrying call keys the token, exactly as an older extension would.
    expect(mapped.step).toBeUndefined()
  })

  test("a malformed payload leaves the items empty instead of guessing", () => {
    const mapped = failure(hub("needs_permission", { items: "everything" }))
    expect(mapped.kind).toBe("permission")
    expect(mapped.items).toEqual([])
  })

  test("an adopt answer names what the browser did; an older extension's empty answer is unconfirmed", () => {
    expect(adoption({ kind: "adopted", groupId: 3 })).toBe("adopted")
    expect(adoption({ kind: "adopted" })).toBe("adopted")
    expect(adoption({ kind: "none" })).toBe("none")
    expect(adoption({ kind: "kept" })).toBe("kept")
    expect(adoption({})).toBe("unconfirmed")
    expect(adoption({ kind: "everything" })).toBe("unconfirmed")
    expect(adoption(undefined)).toBe("unconfirmed")
  })

  test("a transport failure from ready is the backend's own failure, not a raw error", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-port-"))
    try {
      const linked = connection({ dir, install: () => Promise.resolve(), start: () => {}, timeout: 300 })
      const error = await linked
        .port(null)
        .ready(300)
        .catch((value: unknown) => value)
      expect(error).toBeInstanceOf(BrowserHub.Failure)
      expect((error as BrowserHub.Failure).kind).toBe("unavailable")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("a client that cannot be created is mapped, not leaked raw", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-port-"))
    try {
      const linked = connection({
        dir,
        install: () => Promise.resolve(),
        start: () => {},
        timeout: 300,
        create: () => {
          throw new Error("the transport cannot start")
        },
      })
      const error = await linked
        .port(null)
        .ready(300)
        .catch((value: unknown) => value)
      expect(error).toBeInstanceOf(BrowserHub.Failure)
      expect((error as BrowserHub.Failure).kind).toBe("unknown")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("a subscription on a transport that cannot be created is handled, not an unhandled rejection", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-port-"))
    // Only the rejection this test triggers counts: another test file in this process may reject for its own reasons,
    // so the marker is unique to this case rather than any failure of the same class.
    const marker = "kilo-port-subscription-marker-2f7c"
    const seen: unknown[] = []
    const ours = (reason: unknown) => String((reason as Error)?.message ?? "").includes(marker)
    const onRejection = (reason: unknown) => {
      if (ours(reason)) seen.push(reason)
    }
    process.on("unhandledRejection", onRejection)
    try {
      const linked = connection({
        dir,
        install: () => Promise.resolve(),
        start: () => {},
        timeout: 300,
        create: () => {
          throw new Error(marker)
        },
      })
      const off = linked.port(null).onRevoked(() => {})
      off()
      // Give the rejected load a turn to settle.
      await Bun.sleep(50)
      expect(seen).toEqual([])
    } finally {
      process.off("unhandledRejection", onRejection)
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("a code the protocol does not name is unknown, never a guessed kind", () => {
    const mapped = failure(new HubError({ code: -32099, message: "who knows" }))
    expect(mapped.kind).toBe("unknown")
    expect(mapped.message).toBe("who knows")
  })

  test("a non-hub error is unknown with its own message", () => {
    expect(failure(new Error("plain"))).toMatchObject({ kind: "unknown", message: "plain" })
    expect(failure("text").message).toBe("text")
  })
})

/** A short run dir: Unix socket paths are capped near 100 bytes. */
async function rundir() {
  const root = await fs.mkdtemp(path.join(process.platform === "win32" ? os.tmpdir() : "/tmp", "kilo-port-"))
  cleanups.push(() => fs.rm(root, { recursive: true, force: true }))
  return root
}

/** An in-process loopback hub registered in `dir`, with the pairing ask answered as the real hub answers it. */
async function host(dir: string, paired: boolean) {
  const hub = createHub({
    mode: "loopback",
    version: "test",
    local: (method) =>
      method === "pairing.url" ? { url: pair.url({ port: 47917, hubId: hub.id, token: randomUUID() }) } : undefined,
  })
  const server = await serve({
    path: process.platform === "win32" ? `\\\\.\\pipe\\kilo-port-${randomUUID()}` : path.join(dir, "h.sock"),
    open(socket) {
      const controller = hub.join(
        (frame) => socket.send(frame),
        () => socket.close(),
      )
      socket.onClose(() => controller.drop())
      return (frame) => controller.frame(frame)
    },
  })
  cleanups.push(() => server.close())
  const entry = Registry.Entry.parse({
    ...Registry.empty({ hubId: hub.id, mode: "loopback", socket: server.path }),
    port: 47917,
    paired,
  })
  await Registry.write(entry, path.join(dir, "hubs"))
  /** An extension attaches and says hello; the returned function drops it. */
  const connect = () => {
    const extension = hub.attach(
      () => true,
      () => undefined,
    )!
    const { type: _type, ...info } = extensionHello()
    extension.hello(info)
    return () => extension.drop()
  }
  return { connect }
}

/**
 * The port a CLI uses, over a real client of the run dir, with the pairing pages it opened. The client is closed
 * before the hub's socket server, which otherwise waits for its connection.
 */
function linked(dir: string, options: { pairAgain?: number; opener?: (url: string) => Promise<void> } = {}) {
  const opened: string[] = []
  const port = connection({
    dir,
    install: () => Promise.resolve(),
    start: () => {},
    opener: async (url) => void opened.push(url),
    create: (input) => {
      const client = createClient(input)
      cleanups.push(() => client.close())
      return client
    },
    ...options,
  }).port(null)
  return { port, opened }
}

/**
 * The failure a `ready` call settles with. A call made with a window far longer than the test's own timeout proves it
 * failed without waiting, with no wall-clock bound to flake on a loaded runner.
 */
async function refused(port: BrowserHub.Port, timeout: number) {
  const error = await port.ready(timeout).then(
    () => undefined,
    (value: unknown) => value,
  )
  if (!(error instanceof BrowserHub.Failure)) throw new Error(`expected a hub failure, got ${String(error)}`)
  return { error }
}

/** A window no test waits out (bun's default test timeout is 5 s), and a clock moved past it. */
const LONG = 600_000
const later = () => setSystemTime(new Date(Date.now() + LONG + 1_000))
afterEach(() => void setSystemTime())

describe("why no extension answers", () => {
  const waiting = (paired: boolean): State => ({
    kind: "waiting",
    hub: Registry.Entry.parse({ ...Registry.empty({ hubId: randomUUID(), mode: "loopback", socket: "s" }), paired }),
  })

  test("each state the client can be in names its own absence", () => {
    expect(absence(waiting(false), { seen: false }, undefined)).toEqual({ kind: "unpaired" })
    expect(absence(waiting(true), { seen: false }, undefined)).toEqual({ kind: "disconnected" })
    // An extension this connection already saw went away, whatever the registry copy says.
    expect(absence(waiting(false), { seen: true }, undefined)).toEqual({ kind: "disconnected" })
    expect(absence({ kind: "connecting", attempt: 1 }, { seen: true }, undefined)).toEqual({ kind: "disconnected" })
    expect(absence({ kind: "connecting", attempt: 1 }, { seen: false }, undefined)).toEqual({ kind: "no_hub" })
    expect(absence({ kind: "reconnecting", attempt: 2, reason: "x" }, { seen: false }, "Work")).toEqual({
      kind: "no_profile",
      profile: "Work",
    })
    // A connected extension that did not answer (a timeout, a cancelled turn) is not reported as gone.
    const hub = Registry.Entry.parse({ ...Registry.empty({ hubId: randomUUID(), mode: "loopback", socket: "s" }) })
    const ready: State = { kind: "ready", hub, extension: extensionHello() }
    expect(absence(ready, { seen: true }, undefined)).toEqual({ kind: "connected" })
  })

  test("no reachable hub is no_hub", async () => {
    const { port } = linked(await rundir())
    const { error } = await refused(port, 200)
    expect(error.kind).toBe("unavailable")
    expect(error.absence).toEqual({ kind: "no_hub" })
  })

  test("a hub no extension ever paired with is unpaired, and a later call fails at once", async () => {
    const dir = await rundir()
    await host(dir, false)
    const { port, opened } = linked(dir, { pairAgain: 10 * LONG })
    const first = await refused(port, 200)
    expect(first.error.absence).toEqual({ kind: "unpaired" })
    await until(() => (opened.length === 1 ? true : undefined))
    // The pairing page is still current, so nothing changed that could bring an extension: no second wait.
    later()
    const second = await refused(port, LONG)
    expect(second.error.absence).toEqual({ kind: "unpaired" })
    expect(opened).toHaveLength(1)
  })

  test("a stale pairing page is opened again, and that call waits for the extension to redeem it", async () => {
    const dir = await rundir()
    const hub = await host(dir, false)
    const { port, opened } = linked(dir, { pairAgain: 0 })
    await refused(port, 100)
    await until(() => (opened.length === 1 ? true : undefined))
    // The call that finds the page stale opens a new one and waits for the extension to redeem it.
    const answered = port.ready(2_000)
    await until(() => (opened.length === 2 ? true : undefined))
    hub.connect()
    expect((await answered).profileLabel).toBe("Default")
  })

  test("a pairing page that could not be opened does not make the call wait for it", async () => {
    const dir = await rundir()
    await host(dir, false)
    let attempts = 0
    const { port } = linked(dir, {
      pairAgain: 0,
      opener: async () => {
        attempts += 1
        throw new Error("no opener on this host")
      },
    })
    await refused(port, 200)
    await until(() => (attempts === 1 ? true : undefined))
    later()
    // The stale page is asked for again, the opener fails, and the call fails at once instead of waiting.
    const { error } = await refused(port, LONG)
    expect(error.absence).toEqual({ kind: "unpaired" })
    expect(attempts).toBe(2)
  })

  test("a pairing page that never opens cannot hold the call past its own timeout", async () => {
    const dir = await rundir()
    await host(dir, false)
    let attempts = 0
    const { port } = linked(dir, {
      pairAgain: 0,
      // The first page opens; the second opener never exits, as a hung `xdg-open` would.
      opener: () => (++attempts === 1 ? Promise.resolve() : Promise.withResolvers<void>().promise),
    })
    await refused(port, 200)
    await until(() => (attempts === 1 ? true : undefined))
    later()
    // Within bun's 5 s test timeout: the call settles at its own 300 ms budget instead of waiting on the opener.
    const { error } = await refused(port, 300)
    expect(error.absence).toEqual({ kind: "unpaired" })
    expect(attempts).toBe(2)
  })

  test("an extension that went away is disconnected; a reconnect inside the window still answers", async () => {
    const dir = await rundir()
    const hub = await host(dir, true)
    const { port } = linked(dir)
    const opened = port.ready(2_000)
    const drop = hub.connect()
    await opened
    drop()
    await until(async () => ((await port.reported()) === undefined ? true : undefined))
    // A call made while its window is still open gets an extension that reconnects inside it.
    const pending = port.ready(LONG)
    const back = hub.connect()
    expect((await pending).profileLabel).toBe("Default")
    back()
    await until(async () => ((await port.reported()) === undefined ? true : undefined))
    // Once the extension has been gone longer than the window, a call fails at once and names why.
    later()
    const { error } = await refused(port, LONG)
    expect(error.absence).toEqual({ kind: "disconnected" })
  })
})
