import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium } from "playwright"
import { DaemonClient, World } from "../src"
import { DaemonServer } from "../src/daemon/server"
import { WorldDaemon } from "../script/daemon"

const session = `test-${process.pid}`
const peer = `${session}-peer`
const home = mkdtempSync(join(tmpdir(), "kilo-world-test-"))
const daemon = join(home, WorldDaemon.filename)
const config = World.currentConfig()
const available = existsSync(chromium.executablePath())
const env = {
  daemon: process.env["KILO_WORLD_DAEMON_PATH"],
  node: process.env["KILO_WORLD_NODE"],
}

beforeAll(async () => {
  await WorldDaemon.copy(await WorldDaemon.bundle(), home)
  process.env["KILO_WORLD_DAEMON_PATH"] = daemon
  process.env["KILO_WORLD_NODE"] = Bun.which("node") ?? "node"
  World.configure({ home })
})

afterAll(async () => {
  await Promise.all([DaemonClient.stop(session), DaemonClient.stop(peer)])
  await Promise.all([
    waitFor(session, () => !DaemonServer.isRunning(session)),
    waitFor(peer, () => !DaemonServer.isRunning(peer)),
  ])
  if (env.daemon === undefined) delete process.env["KILO_WORLD_DAEMON_PATH"]
  else process.env["KILO_WORLD_DAEMON_PATH"] = env.daemon
  if (env.node === undefined) delete process.env["KILO_WORLD_NODE"]
  else process.env["KILO_WORLD_NODE"] = env.node
  World.configure(config)
  rmSync(home, { recursive: true, force: true })
})

describe("world daemon", () => {
  test("records every packaged daemon output", () => {
    const files: unknown = JSON.parse(readFileSync(join(home, WorldDaemon.manifest), "utf8"))
    expect(files).toBeArray()
    expect(files).toContain(WorldDaemon.filename)
  })

  test("reports invalid daemon and runtime overrides", async () => {
    process.env["KILO_WORLD_DAEMON_PATH"] = join(home, "missing.js")
    await expect(DaemonClient.ensureRunning(`${session}-missing`)).rejects.toThrow(
      "KILO_WORLD_DAEMON_PATH does not exist",
    )
    process.env["KILO_WORLD_DAEMON_PATH"] = daemon

    process.env["KILO_WORLD_NODE"] = join(home, "missing-node")
    await expect(DaemonClient.ensureRunning(`${session}-runtime`)).rejects.toThrow("KILO_WORLD_NODE does not exist")
    process.env["KILO_WORLD_NODE"] = Bun.which("node") ?? "node"
  })

  test("deduplicates concurrent startup and serves authenticated requests", async () => {
    await Promise.all([
      DaemonClient.ensureRunning(session, { idleMs: 0 }),
      DaemonClient.ensureRunning(session, { idleMs: 0 }),
      DaemonClient.ensureRunning(session, { idleMs: 0 }),
    ])
    const handshake = DaemonClient.handshake(session)
    expect(handshake).not.toBeNull()
    expect(DaemonServer.isRunning(session)).toBe(true)

    const denied = await fetch(`${handshake!.url}/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "denied", verb: "__status__", args: [], auth: "wrong" }),
    })
    expect(denied.status).toBe(401)

    const unsafe = await fetch(`${handshake!.url}/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "unsafe",
        verb: "status",
        args: [],
        auth: handshake!.token,
        config: { browser: { executablePath: "/tmp/browser" } },
      }),
    })
    expect(unsafe.status).toBe(400)

    if (process.platform !== "win32") {
      expect(statSync(DaemonServer.pidPath(session)).mode & 0o777).toBe(0o600)
      expect(statSync(DaemonServer.handshakePath(session)).mode & 0o777).toBe(0o600)
    }
  })

  test("rejects negative idle timeouts", async () => {
    await expect(World.setDaemonIdle(session, -1)).rejects.toThrow("cannot be negative")
  })

  test("rejects filesystem paths that were not approved by the caller", async () => {
    const file = join(home, "evaluate.js")
    writeFileSync(file, "document.title")
    const result = await World.runForSession(session, `evaluate --js-file ${JSON.stringify(file)}`)
    expect(result.ok).toBe(false)
    expect(result.results[0]?.error).toContain("path was not authorized")
  })

  test("reports runtime status without launching Chromium", async () => {
    await World.setDaemonIdle(session, 0)
    const result = await World.runForSession(session, "daemon.status ; status", {
      config: World.currentConfig(),
    })
    expect(result.ok).toBe(true)
    expect(result.results).toHaveLength(2)
    expect(result.results[0]?.data).toMatchObject({
      running: true,
      runtime: "node",
      idleTimeoutMs: 0,
      idleTimeoutRemainingMs: 0,
    })
    expect(result.results[1]?.data).toMatchObject({
      capability: expect.not.objectContaining({ chromiumVersion: expect.anything() }),
    })
    expect(await World.daemonStatus(session)).toMatchObject({ runtime: "node", runtimeVersion: expect.any(String) })
  })

  test.skipIf(!available)("isolates browser state and processes between sessions", async () => {
    const [first, second] = await Promise.all([
      World.runForSession(
        session,
        'navigate --url "data:text/html,<title>First</title>" ; evaluate --js "document.title"',
      ),
      World.runForSession(
        peer,
        'navigate --url "data:text/html,<title>Second</title>" ; evaluate --js "document.title"',
      ),
    ])
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(first.results[1]?.data).toEqual({ result: "First" })
    expect(second.results[1]?.data).toEqual({ result: "Second" })
    expect(DaemonClient.handshake(session)?.pid).not.toBe(DaemonClient.handshake(peer)?.pid)

    const [firstState, secondState] = await Promise.all([
      World.runForSession(session, 'evaluate --js "document.title"'),
      World.runForSession(peer, 'evaluate --js "document.title"'),
    ])
    expect(firstState.results[0]?.data).toEqual({ result: "First" })
    expect(secondState.results[0]?.data).toEqual({ result: "Second" })

    const file = join(home, "daemon-browser.png")
    const shot = await World.runForSession(session, `screenshot --out ${JSON.stringify(file)} --full --type png`, {
      paths: [file],
    })
    expect(shot.ok).toBe(true)
    expect(shot.results[0]?.screenshot).toMatchObject({ path: file, mime: "image/png" })
    expect(statSync(file).size).toBeGreaterThan(0)

    expect(await DaemonClient.stop(peer)).toBe(true)
    await waitFor(peer, () => !DaemonServer.isRunning(peer))
  })

  test.skipIf(!available)("preserves runner guarantees under Node", async () => {
    const dir = join(import.meta.dirname, "..", "node_modules")
    mkdirSync(dir, { recursive: true })
    const root = mkdtempSync(join(dir, ".kilo-world-runner-"))
    try {
      const result = await Bun.build({
        entrypoints: [join(import.meta.dirname, "runner-node.ts")],
        target: "node",
        format: "esm",
        external: ["chromium-bidi", "electron", "playwright"],
      })
      expect(result.success).toBe(true)
      const output = result.outputs[0]
      if (!output) throw new Error("runner Node test bundle produced no output")
      const file = join(root, "runner-node.mjs")
      await Bun.write(file, output)
      const child = Bun.spawn({
        cmd: [process.env["KILO_WORLD_NODE"]!, file],
        env: { ...process.env, KILO_WORLD_HOME: join(home, "runner") },
        stdout: "pipe",
        stderr: "pipe",
      })
      try {
        const [code, stdout, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ])
        expect(code, `${stdout}\n${stderr}`).toBe(0)
      } finally {
        if (child.exitCode === null) child.kill()
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test.skipIf(!available)("assigns distinct refs to elements with the same accessible name", async () => {
    const result = await World.runForSession(
      session,
      'navigate --url "data:text/html,<button id=one>Same</button><button id=two>Same</button>" ; snapshot ; click --ref e2 ; evaluate --js "document.activeElement.id"',
    )
    expect(result.ok).toBe(true)
    expect(result.results[1]?.refs?.map((entry) => entry.ref)).toEqual(["e1", "e2"])
    expect(result.results[3]?.data).toEqual({ result: "two" })
  })

  test.skipIf(!available)("preserves sensitive-looking accessible names in snapshots", async () => {
    const result = await World.runForSession(
      session,
      'navigate --url "data:text/html,<label for=pin>Security PIN</label><input id=pin placeholder=%27Enter API token%27>" ; snapshot',
    )
    expect(result.ok).toBe(true)
    expect(result.results[1]?.refs).toEqual([expect.objectContaining({ role: "textbox", name: "Security PIN" })])
    expect(result.results[1]?.data).toEqual(
      expect.objectContaining({ snapshot: expect.stringContaining('"Security PIN"') }),
    )
  })

  test.skipIf(!available)("installs anti-detection before documents load", async () => {
    const current = World.currentConfig()
    try {
      const result = await World.runForSession(
        session,
        'navigate --url "data:text/html,<title>Detection</title>" ; evaluate --js "navigator.webdriver"',
        { config: { ...current, browser: { ...current.browser, antiDetect: true } } },
      )
      expect(result.ok).toBe(true)
      expect(result.results[1]?.data).toEqual({ result: null })
    } finally {
      await World.runForSession(session, "status", { config: current })
    }
  })

  test.skipIf(!available)("preserves key casing and supports the plus key", async () => {
    const result = await World.runForSession(session, 'press-key --chord "A" ; press-key --chord "+"')
    expect(result.ok).toBe(true)
    expect(result.results.map((item) => item.data)).toEqual([
      { chord: "A", keys: 1 },
      { chord: "+", keys: 1 },
    ])
  })

  test.skipIf(!available)("tracks the active page while opening and closing tabs", async () => {
    const result = await World.runForSession(
      session,
      'tabs open --url "data:text/html,<title>Second</title>" ; tabs list ; tabs close ; tabs list',
    )
    expect(result.ok).toBe(true)
    expect(result.results[1]?.data).toEqual([
      expect.objectContaining({ index: 0, active: false }),
      expect.objectContaining({ index: 1, title: "Second", active: true }),
    ])
    expect(result.results[3]?.data).toEqual([expect.objectContaining({ index: 0, active: true })])
  })

  test.skipIf(!available)("opens a blank tab when no URL is provided", async () => {
    const result = await World.runForSession(session, "tabs open")
    expect(result.ok).toBe(true)
    expect(result.results[0]?.data).toEqual(expect.objectContaining({ url: "about:blank" }))
  })

  test.skipIf(!available)("invalidates refs after navigation", async () => {
    await World.runForSession(session, 'navigate --url "data:text/html,<button>First</button>" ; snapshot')
    const result = await World.runForSession(
      session,
      'navigate --url "data:text/html,<button>Second</button>" ; click --ref e1',
    )
    expect(result.ok).toBe(false)
    expect(result.results[1]?.error).toContain("run snapshot first")
  })

  test.skipIf(!available)("cancels an action already running in Chromium", async () => {
    await World.runForSession(session, 'navigate --url "data:text/html,<title>Cancel</title>"')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 100)
    const error = await World.runForSession(session, 'evaluate --js "new Promise(() => {})"', {
      signal: controller.signal,
    }).then(
      () => undefined,
      (err: unknown) => err,
    )
    expect(error).toBeInstanceOf(Error)
    expect(error).toHaveProperty("message", expect.stringMatching(/aborted/))
    clearTimeout(timer)
  })

  test("stops cleanly and removes private state files", async () => {
    expect(await DaemonClient.stop(session)).toBe(true)
    await waitFor(session, () => !DaemonServer.isRunning(session))
    await expect(Bun.file(DaemonServer.pidPath(session)).exists()).resolves.toBe(false)
    await expect(Bun.file(DaemonServer.handshakePath(session)).exists()).resolves.toBe(false)
  })
})

async function waitFor(id: string, check: () => boolean) {
  const start = Date.now()
  while (Date.now() - start < 5000) {
    if (check()) return
    await Bun.sleep(25)
  }
  const pid = readFileSync(DaemonServer.pidPath(id), "utf8")
  throw new Error(`daemon did not stop (pid ${pid})`)
}
