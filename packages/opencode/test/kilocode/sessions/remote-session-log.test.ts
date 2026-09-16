// The two log lines `kilo remote` writes about the sessions it hosts:
// one when a session starts (id, start date, model, directory) and one when it
// ends (id, start date, duration, exit reason).
//
// The lines are asserted through the production seams (`RemoteSender`'s
// injected logger for the create/exit wire commands, `RemoteSessionLog.endAll`
// for the process-exit path), so a wiring regression fails here.

import { describe, expect, test } from "bun:test"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import * as Log from "@opencode-ai/core/util/log"
import { RemoteSender } from "../../../src/kilo-sessions/remote-sender"
import { RemoteSessionLog } from "../../../src/kilo-sessions/remote-session-log"
import type { RemoteWS } from "../../../src/kilo-sessions/remote-ws"
import type { RemoteProtocol } from "../../../src/kilo-sessions/remote-protocol"
import { SessionID } from "../../../src/session/schema"
import { Session } from "../../../src/session/session"

type Line = [string, Record<string, any>]

function capture() {
  const lines: Line[] = []
  return { log: captureLogger(lines), lines }
}

function captureLogger(lines: Line[]) {
  return {
    info: (...args: unknown[]) => lines.push(args as Line),
    error: (...args: unknown[]) => lines.push(args as Line),
    warn: (...args: unknown[]) => lines.push(args as Line),
  }
}

function fakeConn() {
  const sent: RemoteProtocol.Outbound[] = []
  return {
    conn: {
      send(msg: RemoteProtocol.Outbound) {
        sent.push(msg)
      },
      close() {},
      async heartbeat() {},
      get connected() {
        return true
      },
    } as RemoteWS.Connection,
    sent,
  }
}

function expectResponse(conn: RemoteWS.Connection, id: string) {
  const resolvers = Promise.withResolvers<RemoteProtocol.Outbound>()
  const previous = conn.send.bind(conn)
  conn.send = (message: RemoteProtocol.Outbound) => {
    if (message?.type === "response" && message.id === id) resolvers.resolve(message)
    previous(message)
  }
  return {
    promise: resolvers.promise,
    restore: () => {
      conn.send = previous
    },
  }
}

function sessionInfo(
  id: SessionID,
  directory: string | undefined,
  model?: { providerID: string; modelID: string },
): Session.Info {
  return {
    id,
    slug: id,
    projectID: ProjectV2.ID.make("project_test"),
    directory,
    title: "Test session",
    version: "test",
    time: { created: Date.now(), updated: Date.now() },
    ...(model
      ? { model: { id: ModelV2.ID.make(model.modelID), providerID: ProviderV2.ID.make(model.providerID) } }
      : {}),
  } as Session.Info
}

// Drives one create_session + exit_cli pair through the real dispatch.
async function runSession(input: {
  lines: Line[]
  created: Session.Info
  createData?: Record<string, unknown>
  useCreateSessionId?: boolean
  attachFails?: boolean
  detachFails?: boolean
  shareRejected?: boolean
}) {
  const { conn } = fakeConn()
  const attachCalls: Array<{ id: SessionID; requireShare?: boolean }> = []
  const sender = RemoteSender.create({
    conn,
    directory: "/tmp/process-default",
    log: captureLogger(input.lines),
    subscribe: () => () => {},
    session: {
      get: async (id) => sessionInfo(id, input.created.directory),
      children: async () => [],
      create: async () => input.created,
      remove: async () => {},
    },
    attachSession: async (id, opts) => {
      attachCalls.push({ id, requireShare: opts?.requireShare })
      // The relay refused the session bootstrap (POST /api/session): the
      // production attach seam fails here with the bootstrap rejection.
      if (input.shareRejected && opts?.requireShare) throw new Error(`Unable to create session ${id}: 409 Conflict`)
      if (input.attachFails) throw new Error("attach failed with secret must-not-leak")
    },
    detachSession: async () => {
      if (input.detachFails) throw new Error("detach failed with secret must-not-leak")
    },
    hasSession: () => true,
    ownedCount: () => 0,
    cancelPrompt: async () => {},
    remoteExit: { get: () => undefined },
  })

  const created = expectResponse(conn, "req_create")
  sender.handle({
    type: "command",
    id: "req_create",
    command: "create_session",
    ...(input.useCreateSessionId === false ? {} : { sessionId: input.created.id }),
    data: input.createData ?? { protocolVersion: 1 },
  })
  await created.promise
  created.restore()

  const exited = expectResponse(conn, "req_exit")
  sender.handle({
    type: "command",
    id: "req_exit",
    command: "exit_cli",
    sessionId: input.created.id,
    data: { protocolVersion: 1 },
  })
  await exited.promise
  exited.restore()

  return { attachCalls }
}

function lineOf(lines: Line[], message: string) {
  return lines.find(([name]) => name === message)
}

describe("kilo remote session log (two lines per session)", () => {
  test("logs a start line and an end line with the id, the start date, the model, the directory and the duration", async () => {
    const { lines } = capture()
    const id = SessionID.make("ses_remote_log_pair")
    const { attachCalls } = await runSession({
      lines,
      created: sessionInfo(id, "/workspace/project-a", { providerID: "kilo", modelID: "claude-sonnet-4" }),
    })

    // The create_session attach makes the relay's acceptance of the session
    // bootstrap a precondition (production `attachSession` enforces it).
    expect(attachCalls).toEqual([{ id, requireShare: true }])

    const started = lineOf(lines, "remote session started")
    expect(started).toBeDefined()
    expect(started![1].startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(started![1]).toEqual({
      sessionID: id,
      startedAt: started![1].startedAt,
      model: "kilo/claude-sonnet-4",
      directory: "/workspace/project-a",
    })

    const ended = lineOf(lines, "remote session ended")
    expect(ended).toBeDefined()
    expect(ended![1]).toEqual({
      sessionID: id,
      startedAt: started![1].startedAt,
      durationMs: expect.any(Number),
      reason: "detached",
    })

    // Exactly the two lines, and neither leaks a credential, a token or prompt text.
    expect(lines.filter(([name]) => name.startsWith("remote session"))).toHaveLength(2)
    expect(JSON.stringify(lines)).not.toContain("must-not-leak")
    expect(JSON.stringify(lines)).not.toContain("token")
  })

  test("reports a measured duration, not a constant zero", async () => {
    const { lines } = capture()
    const id = SessionID.make("ses_remote_log_duration")
    const log = captureLogger(lines)

    RemoteSessionLog.start(log, { sessionID: id, directory: "/workspace/project-a" })
    // Real time must advance past the timestamp resolution for the interval to
    // be measurable; the sleep IS the test here.
    await Bun.sleep(20)
    RemoteSessionLog.end(log, { sessionID: id, reason: "detached" })

    expect(lineOf(lines, "remote session ended")![1].durationMs).toBeGreaterThanOrEqual(10)
  })

  test("falls back to the requested model and the launch directory when the session row carries neither", async () => {
    const { lines } = capture()
    const id = SessionID.make("ses_remote_log_fallback")
    await runSession({
      lines,
      created: sessionInfo(id, undefined),
      createData: { protocolVersion: 1, model: { providerID: "kilo", modelID: "claude-sonnet-4" } },
      useCreateSessionId: false,
    })

    const started = lineOf(lines, "remote session started")
    expect(started![1].model).toBe("kilo/claude-sonnet-4")
    expect(started![1].directory).toBe("/tmp/process-default")
  })

  test("logs no start line when the attach is rolled back", async () => {
    const { lines } = capture()
    await runSession({
      lines,
      created: sessionInfo(SessionID.make("ses_remote_log_attach_fail"), "/workspace/project-a"),
      attachFails: true,
    })

    expect(lineOf(lines, "remote session started")).toBeUndefined()
    expect(lineOf(lines, "remote session ended")).toBeUndefined()
    expect(lineOf(lines, "create session failed")).toBeDefined()
  })

  test("logs no start line when the relay refuses the session bootstrap", async () => {
    const { lines } = capture()
    await runSession({
      lines,
      created: sessionInfo(SessionID.make("ses_remote_log_share_refused"), "/workspace/project-a"),
      shareRejected: true,
    })

    // The relay refused the session, so the command rolls it back and the
    // session never gets a start line (nor a paired end line later).
    expect(lineOf(lines, "remote session started")).toBeUndefined()
    expect(lineOf(lines, "remote session ended")).toBeUndefined()
    expect(lineOf(lines, "create session rolled back")).toBeDefined()
    expect(lineOf(lines, "create session failed")).toBeDefined()
  })

  test("logs no end line when the detach fails", async () => {
    const { lines } = capture()
    await runSession({
      lines,
      created: sessionInfo(SessionID.make("ses_remote_log_detach_fail"), "/workspace/project-a"),
      detachFails: true,
    })

    expect(lineOf(lines, "remote session started")).toBeDefined()
    expect(lineOf(lines, "remote session ended")).toBeUndefined()
    expect(lineOf(lines, "exit CLI failed before ACK")).toBeDefined()
  })

  test("logs nothing for a session this run never started", () => {
    const { lines } = capture()
    const log = captureLogger(lines)

    // An adopted session (created by an earlier run, announced to this one by
    // presence) has no observed start here, so it produces no half line.
    RemoteSessionLog.end(log, { sessionID: SessionID.make("ses_remote_log_adopted"), reason: "detached" })

    expect(lines).toEqual([])
  })

  test("endAll closes the sessions this run started with the shutdown reason and leaves the rest alone", () => {
    const { lines } = capture()
    const first = SessionID.make("ses_remote_log_shutdown_a")
    const second = SessionID.make("ses_remote_log_shutdown_b")
    const log = captureLogger(lines)

    // The tracker is process-wide (one process = one run); drain anything an
    // earlier case left open so this case observes only its own sessions.
    RemoteSessionLog.endAll(captureLogger([]), "test_setup")

    RemoteSessionLog.start(log, { sessionID: first, model: "kilo/claude-sonnet-4", directory: "/workspace/a" })
    RemoteSessionLog.start(log, { sessionID: second, directory: "/workspace/b" })
    lines.length = 0

    RemoteSessionLog.endAll(log, "shutdown")

    expect(lines.map(([, fields]) => fields.sessionID).sort()).toEqual([first, second].sort())
    for (const [, fields] of lines) {
      expect(fields.reason).toBe("shutdown")
      expect(typeof fields.startedAt).toBe("string")
      expect(typeof fields.durationMs).toBe("number")
    }

    // Idempotent: the open set is drained, so a second exit logs nothing more.
    RemoteSessionLog.endAll(log, "shutdown")
    expect(lines).toHaveLength(2)
  })

  test("renders both lines through the CLI's own logger, at its own level and service", async () => {
    const writes: string[] = []
    const original = process.stderr.write
    process.stderr.write = ((chunk: unknown) => {
      writes.push(String(chunk))
      return true
    }) as typeof process.stderr.write
    await Log.init({ print: true, level: "INFO" })
    const log = Log.create({ service: "kilo-sessions" })
    const id = SessionID.make("ses_remote_log_rendered")

    RemoteSessionLog.start(log, { sessionID: id, model: "kilo/claude-sonnet-4", directory: "/workspace/a" })
    await Bun.sleep(20)
    RemoteSessionLog.end(log, { sessionID: id, reason: "deleted" })
    process.stderr.write = original

    const out = writes.join("")
    expect(out).toContain("service=kilo-sessions")
    expect(out).toContain("remote session started")
    expect(out).toContain("remote session ended")
    expect(out).toContain(`sessionID=${id}`)
    expect(out).toContain("model=kilo/claude-sonnet-4")
    expect(out).toContain("directory=/workspace/a")
    expect(out).toContain("reason=deleted")
    expect(out).toMatch(/startedAt=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/)
    expect(out).toMatch(/durationMs=[1-9]\d*/)
  })
})
