import { describe, expect, test } from "bun:test"
import { dict } from "@kilocode/kilo-i18n/en"
import net from "node:net"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { Plugin } from "@opencode/plugin/tui"
import {
  buildRequest,
  buildResumeArgv,
  createReporter,
  createSender,
  replyRejection,
  sendSocketRequest,
  socketPathTooLong,
  status,
  type HerdrMethod,
  type HerdrReport,
} from "../../src/kilocode/herdr-agent-state"

type Data = Plugin.Context["data"]

// These tests listen on a unix socket path; Windows serves the same protocol on a named pipe.
const unix = test.skipIf(process.platform === "win32")

interface Scene {
  roots?: Record<string, string>
  family?: Record<string, string[]>
  status?: Record<string, "idle" | "running">
  permissions?: Record<string, number>
  forms?: Record<string, number>
  pending?: Record<string, Array<{ type: string }>>
}

function data(scene: Scene = {}): Data {
  return {
    session: {
      root: (id: string) => scene.roots?.[id] ?? id,
      family: (id: string) => scene.family?.[id] ?? [],
      status: (id: string) => scene.status?.[id] ?? "idle",
      permission: { list: (id: string) => Array.from({ length: scene.permissions?.[id] ?? 0 }, () => ({})) },
      form: { list: (id: string) => Array.from({ length: scene.forms?.[id] ?? 0 }, () => ({})) },
      pending: { list: (id: string) => scene.pending?.[id] ?? [] },
    },
  } as unknown as Data
}

describe("herdr agent state", () => {
  test("builds validated resume_argv commands and rejects invalid inputs", () => {
    expect(buildResumeArgv("ses_1", "kilo2")).toEqual(["kilo2", "--session", "ses_1"])
    expect(buildResumeArgv("ses_1", "kilo")).toEqual(["kilo", "--session", "ses_1"])
    expect(buildResumeArgv(undefined, "kilo")).toBeUndefined()
    expect(buildResumeArgv("", "kilo")).toBeUndefined()
    expect(buildResumeArgv("ses_1", "/usr/local/bin/kilo2")).toBeUndefined()
    expect(buildResumeArgv("ses_1", "-kilo")).toBeUndefined()
    expect(buildResumeArgv("ses_1", "kilo 2")).toBeUndefined()
    expect(buildResumeArgv("ses'1", "kilo")).toBeUndefined()
    expect(buildResumeArgv("ses\n1", "kilo")).toBeUndefined()
    expect(buildResumeArgv("x".repeat(8_200), "kilo")).toBeUndefined()
  })

  test("reports idle without a session", () => {
    expect(status(data(), undefined)).toEqual({ state: "idle" })
  })

  test("reports idle for an idle session with its root id", () => {
    expect(status(data({ roots: { ses_child: "ses_root" } }), "ses_child")).toEqual({
      state: "idle",
      sessionID: "ses_root",
    })
  })

  test("reports working when the session, a subagent, or a non-synthetic pending item is active", () => {
    expect(status(data({ status: { ses_1: "running" } }), "ses_1")).toEqual({
      state: "working",
      sessionID: "ses_1",
    })
    expect(status(data({ family: { ses_1: ["ses_1", "ses_2"] }, status: { ses_2: "running" } }), "ses_1")).toEqual({
      state: "working",
      sessionID: "ses_1",
    })
    expect(status(data({ pending: { ses_1: [{ type: "user" }] } }), "ses_1")).toEqual({
      state: "working",
      sessionID: "ses_1",
    })
    expect(status(data({ pending: { ses_1: [{ type: "synthetic" }] } }), "ses_1")).toEqual({
      state: "idle",
      sessionID: "ses_1",
    })
  })

  test("reports blocked with a message for permissions or forms, including subagents", () => {
    expect(status(data({ permissions: { ses_1: 1 } }), "ses_1")).toEqual({
      state: "blocked",
      sessionID: "ses_1",
      message: dict["tui.herdr.waitingForPermission"],
    })
    expect(status(data({ family: { ses_1: ["ses_1", "ses_2"] }, forms: { ses_2: 1 } }), "ses_1")).toEqual({
      state: "blocked",
      sessionID: "ses_1",
      message: dict["tui.herdr.waitingForAnswer"],
    })
  })

  test("blocked takes precedence over a running member of the same family", () => {
    const family = { ses_1: ["ses_1", "ses_2"] }
    expect(status(data({ family, permissions: { ses_2: 1 }, status: { ses_1: "running" } }), "ses_1")).toEqual({
      state: "blocked",
      sessionID: "ses_1",
      message: dict["tui.herdr.waitingForPermission"],
    })
    expect(
      status(data({ family, forms: { ses_1: 1 }, status: { ses_2: "running" }, permissions: { ses_2: 1 } }), "ses_1"),
    ).toEqual({ state: "blocked", sessionID: "ses_1", message: dict["tui.herdr.waitingForPermission"] })
    expect(status(data({ family, forms: { ses_1: 1 }, status: { ses_2: "running" } }), "ses_1")).toEqual({
      state: "blocked",
      sessionID: "ses_1",
      message: dict["tui.herdr.waitingForAnswer"],
    })
  })

  test("builds pane.report_agent and pane.release_agent payloads", () => {
    expect(
      buildRequest({
        method: "pane.report_agent",
        paneID: "wE:p5",
        seq: 42,
        report: { state: "blocked", sessionID: "ses_1", message: dict["tui.herdr.waitingForPermission"] },
        command: "kilo2",
      }),
    ).toEqual({
      id: "kilo:42",
      method: "pane.report_agent",
      params: {
        pane_id: "wE:p5",
        source: "kilo",
        agent: "kilo",
        seq: 42,
        state: "blocked",
        agent_session_id: "ses_1",
        resume_argv: ["kilo2", "--session", "ses_1"],
        message: dict["tui.herdr.waitingForPermission"],
      },
    })

    expect(
      buildRequest({
        method: "pane.report_agent",
        paneID: "wE:p5",
        seq: 43,
        report: { state: "idle" },
        command: "kilo2",
      }),
    ).toEqual({
      id: "kilo:43",
      method: "pane.report_agent",
      params: {
        pane_id: "wE:p5",
        source: "kilo",
        agent: "kilo",
        seq: 43,
        state: "idle",
      },
    })

    expect(
      buildRequest({
        method: "pane.release_agent",
        paneID: "wE:p5",
        seq: 44,
      }),
    ).toEqual({
      id: "kilo:44",
      method: "pane.release_agent",
      params: {
        pane_id: "wE:p5",
        source: "kilo",
        agent: "kilo",
        seq: 44,
      },
    })
  })

  test("reports on changes, deduplicates identical state, and releases on stop", async () => {
    const sent: Array<{ method: HerdrMethod; seq: number; report?: HerdrReport }> = []
    const scene: Scene = {}
    let currentSession: string | undefined
    const reporter = createReporter({
      data: data(scene),
      session: () => currentSession,
      send: (method, seq, report) => {
        sent.push({ method, seq, report })
        return Promise.resolve(true)
      },
      now: () => 1_000,
    })

    reporter.tick()
    await Promise.resolve()
    reporter.tick()
    expect(sent).toEqual([{ method: "pane.report_agent", seq: 1_000_001, report: { state: "idle" } }])

    currentSession = "ses_1"
    scene.status = { ses_1: "running" }
    reporter.tick()
    await Promise.resolve()
    reporter.tick()
    expect(sent.at(-1)).toEqual({
      method: "pane.report_agent",
      seq: 1_000_002,
      report: { state: "working", sessionID: "ses_1" },
    })
    expect(sent).toHaveLength(2)

    await reporter.stop()
    expect(sent.at(-1)).toEqual({ method: "pane.release_agent", seq: 1_000_003, report: undefined })
  })

  test("retries an unchanged state after a failed send and stops once it is delivered", async () => {
    const sent: number[] = []
    const outcomes = [false, false, true]
    const reporter = createReporter({
      data: data({ status: { ses_1: "running" } }),
      session: () => "ses_1",
      send: (_method, seq) => {
        sent.push(seq)
        return Promise.resolve(outcomes.shift() ?? true)
      },
      now: () => 1_000,
    })

    for (let i = 0; i < 5; i++) {
      reporter.tick()
      await Promise.resolve()
      await Promise.resolve()
    }
    expect(sent).toEqual([1_000_001, 1_000_002, 1_000_003])
  })

  test("retries a failed send on its own, without another state change", async () => {
    const sent: number[] = []
    const delivered = Promise.withResolvers<void>()
    const reporter = createReporter({
      data: data({ status: { ses_1: "running" } }),
      session: () => "ses_1",
      send: (_method, seq) => {
        sent.push(seq)
        if (sent.length === 3) delivered.resolve()
        return Promise.resolve(sent.length === 3)
      },
      now: () => 1_000,
      retryMs: 1,
    })

    reporter.tick()
    await delivered.promise
    await Bun.sleep(10)
    expect(sent).toEqual([1_000_001, 1_000_002, 1_000_003])
  })

  test("stops retrying once released", async () => {
    const sent: string[] = []
    const reporter = createReporter({
      data: data({ status: { ses_1: "running" } }),
      session: () => "ses_1",
      send: (method) => {
        sent.push(method)
        return Promise.resolve(false)
      },
      now: () => 1_000,
      retryMs: 1,
    })

    reporter.tick()
    await reporter.stop()
    await Bun.sleep(10)
    reporter.tick()
    expect(sent).toEqual(["pane.report_agent", "pane.release_agent"])
  })

  test("reads a rejection out of a Herdr reply line", () => {
    expect(replyRejection('{"id":"kilo:1","result":{"type":"ok"}}')).toBeUndefined()
    expect(
      replyRejection('{"id":"kilo:1","error":{"code":"pane_not_found","message":"pane w9:p9 not found"}}'),
    ).toBe("pane_not_found: pane w9:p9 not found")
    expect(replyRejection('{"id":"kilo:1","error":{}}')).toBe("rejected")
    expect(replyRejection("not json")).toBe("malformed reply")
  })

  test("flags socket paths that do not fit sun_path", () => {
    expect(socketPathTooLong("/tmp/herdr.sock", "darwin")).toBe(false)
    expect(socketPathTooLong("x".repeat(103), "darwin")).toBe(false)
    expect(socketPathTooLong("x".repeat(104), "darwin")).toBe(true)
    expect(socketPathTooLong("x".repeat(107), "linux")).toBe(false)
    expect(socketPathTooLong("x".repeat(108), "linux")).toBe(true)
    expect(socketPathTooLong("é".repeat(52), "darwin")).toBe(true)
    expect(socketPathTooLong("x".repeat(300), "win32")).toBe(false)
  })

  unix("reports a rejected request once it is answered", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "herdr-reject-"))
    const socketPath = path.join(dir, "herdr.sock")
    const server = net.createServer((socket) => {
      socket.on("data", () => {
        socket.write('{"id":"kilo:1","error":{"code":"invalid_res')
        socket.write('ume_argv","message":"bad argv"}}\n')
      })
    })
    await new Promise<void>((resolve) => server.listen(socketPath, resolve))
    try {
      const rejected: string[] = []
      expect(await sendSocketRequest(socketPath, "{}", 500, (reason) => rejected.push(reason))).toBe(true)
      expect(rejected).toEqual(["invalid_resume_argv: bad argv"])
    } finally {
      server.close()
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("does not resend a state while its send is still in flight", async () => {
    const sent: number[] = []
    const pending = Promise.withResolvers<boolean>()
    const reporter = createReporter({
      data: data({ status: { ses_1: "running" } }),
      session: () => "ses_1",
      send: (_method, seq) => {
        sent.push(seq)
        return pending.promise
      },
      now: () => 1_000,
    })

    reporter.tick()
    reporter.tick()
    reporter.tick()
    expect(sent).toEqual([1_000_001])
    pending.resolve(true)
    await pending.promise
    await Promise.resolve()
    reporter.tick()
    expect(sent).toEqual([1_000_001])
  })

  test("sendSocketRequest reports failure when the socket is unreachable", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "herdr-missing-"))
    try {
      expect(await sendSocketRequest(path.join(dir, "missing.sock"), "{}", 200)).toBe(false)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  unix("sends newline-delimited JSON over a unix socket", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "herdr-test-"))
    const socketPath = path.join(dir, "herdr.sock")
    const received: string[] = []
    const server = net.createServer((socket) => {
      socket.on("data", (chunk) => {
        received.push(chunk.toString("utf8"))
        socket.write('{"ok":true}\n')
      })
    })
    await new Promise<void>((resolve) => server.listen(socketPath, resolve))
    try {
      const payload = JSON.stringify(buildRequest({ method: "pane.report_agent", paneID: "w1:p1", seq: 1, report: { state: "idle" } }))
      expect(await sendSocketRequest(socketPath, payload)).toBe(true)
      expect(received.join("")).toBe(`${payload}\n`)
    } finally {
      server.close()
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  unix("sendSocketRequest times out when the server never replies", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "herdr-timeout-"))
    const socketPath = path.join(dir, "herdr.sock")
    const sockets = new Set<net.Socket>()
    const server = net.createServer((socket) => {
      sockets.add(socket)
      socket.on("close", () => sockets.delete(socket))
    })
    await new Promise<void>((resolve) => server.listen(socketPath, resolve))
    try {
      const payload = JSON.stringify(buildRequest({ method: "pane.report_agent", paneID: "w1:p1", seq: 1, report: { state: "idle" } }))
      const start = Date.now()
      expect(await sendSocketRequest(socketPath, payload, 50)).toBe(false)
      expect(Date.now() - start).toBeLessThan(1_000)
    } finally {
      for (const socket of sockets) socket.destroy()
      server.close()
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("coalesces stale reports while a send is in flight", async () => {
    const sent: number[] = []
    const first = Promise.withResolvers<void>()
    const started = Promise.withResolvers<void>()
    const send = createSender({
      paneID: "w1:p1",
      timeoutMs: 500,
      transport: (payload) => {
        const parsed = JSON.parse(payload) as { params: { seq: number } }
        sent.push(parsed.params.seq)
        started.resolve()
        if (parsed.params.seq === 1) return first.promise.then(() => true)
        return Promise.resolve(true)
      },
    })

    const firstResult = send("pane.report_agent", 1, { state: "working", sessionID: "ses_1" })
    await started.promise
    const replaced = [
      send("pane.report_agent", 2, { state: "blocked", sessionID: "ses_1", message: dict["tui.herdr.waitingForPermission"] }),
      send("pane.report_agent", 3, { state: "idle", sessionID: "ses_1" }),
    ]
    const release = send("pane.release_agent", 4)

    expect(sent).toEqual([1])
    expect(await Promise.all(replaced)).toEqual([false, false])
    first.resolve()
    expect(await firstResult).toBe(true)
    expect(await release).toBe(true)
    expect(sent).toEqual([1, 4])
  })

  test("times out a hung transport and continues with the latest pending report", async () => {
    const sent: number[] = []
    const hung = Promise.withResolvers<void>()
    const send = createSender({
      paneID: "w1:p1",
      timeoutMs: 30,
      transport: (payload) => {
        const parsed = JSON.parse(payload) as { params: { seq: number } }
        sent.push(parsed.params.seq)
        if (parsed.params.seq === 1) return hung.promise.then(() => true)
        return Promise.resolve(true)
      },
    })

    const hungResult = send("pane.report_agent", 1, { state: "working", sessionID: "ses_1" })
    send("pane.report_agent", 2, { state: "idle", sessionID: "ses_1" })
    const latest = send("pane.report_agent", 3, { state: "blocked", sessionID: "ses_1", message: dict["tui.herdr.waitingForAnswer"] })

    expect(await hungResult).toBe(false)
    expect(await latest).toBe(true)
    expect(sent).toEqual([1, 3])
  })

  unix("waits for report and release timeouts before subprocess exit", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "herdr-shutdown-"))
    const socketPath = path.join(dir, "herdr.sock")
    const sockets = new Set<net.Socket>()
    const requests: string[] = []
    let buffer = ""
    const server = net.createServer((socket) => {
      sockets.add(socket)
      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8")
        while (buffer.includes("\n")) {
          const index = buffer.indexOf("\n")
          const line = buffer.slice(0, index)
          buffer = buffer.slice(index + 1)
          if (line) requests.push(line)
        }
      })
      socket.on("error", () => undefined)
      socket.on("close", () => sockets.delete(socket))
    })
    const listening = Promise.withResolvers<void>()
    server.once("error", listening.reject)
    server.listen(socketPath, () => listening.resolve())
    await listening.promise

    const modulePath = fileURLToPath(new URL("../../src/kilocode/herdr-agent-state.ts", import.meta.url))
    const script = [
      `import { createReporter, createSender, sendSocketRequest } from ${JSON.stringify(modulePath)}`,
      `const send = createSender({ paneID: "w1:p1", timeoutMs: 100, transport: (payload) => sendSocketRequest(${JSON.stringify(socketPath)}, payload, 100) })`,
      `const reporter = createReporter({`,
      `  data: { session: {`,
      `    root: (id) => id, family: () => [], status: () => "running",`,
      `    permission: { list: () => [] }, form: { list: () => [] }, pending: { list: () => [] },`,
      `  } },`,
      `  session: () => "ses_1", send, now: () => 1_000,`,
      `})`,
      `const started = performance.now()`,
      `reporter.tick()`,
      `await reporter.stop()`,
      `process.stdout.write(String(performance.now() - started))`,
    ].join("\n")
    const started = performance.now()
    const child = Bun.spawn([process.execPath, "-e", script], {
      cwd: fileURLToPath(new URL("../..", import.meta.url)),
      env: {
        ...process.env,
        OPENCODE_TEST_HOME: path.join(dir, "home"),
        XDG_CONFIG_HOME: path.join(dir, "config"),
        XDG_DATA_HOME: path.join(dir, "data"),
        XDG_CACHE_HOME: path.join(dir, "cache"),
      },
      stdout: "pipe",
      stderr: "pipe",
    })
    // The watchdog bounds a real child/socket integration test; completion is driven by the child's awaited drain.
    const killTimer = setTimeout(() => child.kill(), 2_500)
    try {
      const [stdout, stderr, exit] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      const elapsed = performance.now() - started
      expect({ stderr, exit }).toEqual({ stderr: "", exit: 0 })
      // Two injected 100 ms send timeouts: the unanswered report, then the unanswered release.
      expect(Number(stdout)).toBeGreaterThanOrEqual(150)
      expect(Number(stdout)).toBeLessThan(2_000)
      expect(elapsed).toBeLessThan(2_500)
      expect(requests.map((request) => JSON.parse(request).method)).toEqual([
        "pane.report_agent",
        "pane.release_agent",
      ])
    } finally {
      clearTimeout(killTimer)
      child.kill()
      for (const socket of sockets) socket.destroy()
      const closed = Promise.withResolvers<void>()
      server.close(() => closed.resolve())
      await closed.promise
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
