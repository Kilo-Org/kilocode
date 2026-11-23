import { describe, expect, test } from "bun:test"
import net from "node:net"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { Plugin } from "@opencode/plugin/tui"
import {
  buildRequest,
  createReporter,
  createSender,
  sendSocketRequest,
  status,
  type HerdrMethod,
  type HerdrReport,
} from "../../src/kilocode/herdr-agent-state"

type Data = Plugin.Context["data"]

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
      message: "Permission needs input",
    })
    expect(status(data({ family: { ses_1: ["ses_1", "ses_2"] }, forms: { ses_2: 1 } }), "ses_1")).toEqual({
      state: "blocked",
      sessionID: "ses_1",
      message: "Input needs response",
    })
  })

  test("builds pane.report_agent and pane.release_agent payloads", () => {
    expect(
      buildRequest({
        method: "pane.report_agent",
        paneID: "wE:p5",
        seq: 42,
        report: { state: "blocked", sessionID: "ses_1", message: "Permission needs input" },
      }),
    ).toEqual({
      id: "kilo2:42",
      method: "pane.report_agent",
      params: {
        pane_id: "wE:p5",
        source: "kilo2",
        agent: "kilo2",
        seq: 42,
        state: "blocked",
        agent_session_id: "ses_1",
        message: "Permission needs input",
      },
    })

    expect(
      buildRequest({
        method: "pane.release_agent",
        paneID: "wE:p5",
        seq: 43,
      }),
    ).toEqual({
      id: "kilo2:43",
      method: "pane.release_agent",
      params: {
        pane_id: "wE:p5",
        source: "kilo2",
        agent: "kilo2",
        seq: 43,
      },
    })
  })

  test("reports on changes, deduplicates identical state, and releases on stop", () => {
    const sent: Array<{ method: HerdrMethod; seq: number; report?: HerdrReport }> = []
    const scene: Scene = {}
    let currentSession: string | undefined
    const reporter = createReporter({
      data: data(scene),
      session: () => currentSession,
      send: (method, seq, report) => sent.push({ method, seq, report }),
      now: () => 1_000,
    })

    reporter.tick()
    reporter.tick()
    expect(sent).toEqual([{ method: "pane.report_agent", seq: 1_000_001, report: { state: "idle" } }])

    currentSession = "ses_1"
    scene.status = { ses_1: "running" }
    reporter.tick()
    reporter.tick()
    expect(sent.at(-1)).toEqual({
      method: "pane.report_agent",
      seq: 1_000_002,
      report: { state: "working", sessionID: "ses_1" },
    })
    expect(sent).toHaveLength(2)

    reporter.stop()
    expect(sent.at(-1)).toEqual({ method: "pane.release_agent", seq: 1_000_003, report: undefined })
  })

  test("sends newline-delimited JSON over a unix socket", async () => {
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
      await sendSocketRequest(socketPath, payload)
      expect(received.join("")).toBe(`${payload}\n`)
    } finally {
      server.close()
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("sendSocketRequest times out when the server never replies", async () => {
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
      await sendSocketRequest(socketPath, payload, 50)
      expect(Date.now() - start).toBeLessThan(1_000)
    } finally {
      for (const socket of sockets) socket.destroy()
      server.close()
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("coalesces stale reports while a send is in flight", async () => {
    const sent: number[] = []
    let releaseFirst: (() => void) | undefined
    const send = createSender({
      paneID: "w1:p1",
      timeoutMs: 500,
      transport: (payload) => {
        const parsed = JSON.parse(payload) as { params: { seq: number } }
        sent.push(parsed.params.seq)
        if (parsed.params.seq === 1) {
          return new Promise<void>((resolve) => {
            releaseFirst = resolve
          })
        }
        return Promise.resolve()
      },
    })

    send("pane.report_agent", 1, { state: "working", sessionID: "ses_1" })
    send("pane.report_agent", 2, { state: "blocked", sessionID: "ses_1", message: "Permission needs input" })
    send("pane.report_agent", 3, { state: "idle", sessionID: "ses_1" })
    send("pane.release_agent", 4)

    expect(sent).toEqual([1])
    releaseFirst?.()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(sent).toEqual([1, 4])
  })

  test("times out a hung transport and continues with the latest pending report", async () => {
    const sent: number[] = []
    const send = createSender({
      paneID: "w1:p1",
      timeoutMs: 30,
      transport: (payload) => {
        const parsed = JSON.parse(payload) as { params: { seq: number } }
        sent.push(parsed.params.seq)
        if (parsed.params.seq === 1) {
          return new Promise<void>(() => {})
        }
        return Promise.resolve()
      },
    })

    send("pane.report_agent", 1, { state: "working", sessionID: "ses_1" })
    send("pane.report_agent", 2, { state: "idle", sessionID: "ses_1" })
    send("pane.report_agent", 3, { state: "blocked", sessionID: "ses_1", message: "Input needs response" })

    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(sent).toEqual([1, 3])
  })
})
