import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { Database } from "@opencode-ai/core/database/database"
import { Global } from "@opencode-ai/core/global"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { MessageTable, SessionTable } from "@opencode-ai/core/session/sql"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Effect, Layer } from "effect"
import { BrowserClient } from "../../../src/kilocode/browser-task/client"
import { BrowserOwner } from "../../../src/kilocode/browser-task/owner"
import { RemoteProtocol } from "../../../src/kilo-sessions/remote-protocol"
import { MessageID, SessionID } from "../../../src/session/schema"
import type { Tool } from "../../../src/tool/tool"
import { tmpdir } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

const it = testEffect(Database.layerFromPath(":memory:"))
const provider = "bp_00000000-0000-4000-8000-000000000001"
const input = { providerId: provider, goal: "Read the page title" } as const
type Request = RemoteProtocol.BrowserRequest
type Owner = Parameters<BrowserClient.Client["run"]>[0]

function seed(sessionID = SessionID.make(`ses_${crypto.randomUUID()}`)) {
  return Effect.gen(function* () {
    const db = yield* Database.Service
    const ctx: Tool.Context = {
      sessionID,
      messageID: MessageID.ascending(),
      callID: crypto.randomUUID(),
      agent: "test",
      abort: new AbortController().signal,
      messages: [],
      ask: () => Effect.void,
      metadata: () => Effect.void,
    }
    const project = ProjectV2.ID.make("b".repeat(40))
    yield* db.db
      .insert(ProjectTable)
      .values({ id: project, worktree: AbsolutePath.make(Global.Path.data), sandboxes: [] })
      .onConflictDoNothing()
      .run()
    yield* db.db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: project,
        slug: "browser-client",
        directory: AbsolutePath.make(Global.Path.data),
        title: "Browser client",
        version: "test",
      })
      .onConflictDoNothing()
      .run()
    const data = {
      role: "assistant" as const,
      time: { created: Date.now() },
      parentID: SessionV1.MessageID.make("msg_parent"),
      providerID: "test",
      modelID: "test",
      mode: "test",
      agent: "test",
      path: { cwd: Global.Path.data, root: Global.Path.data },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    }
    yield* db.db
      .insert(MessageTable)
      .values({
        id: SessionV1.MessageID.make(ctx.messageID),
        session_id: sessionID,
        time_created: Date.now(),
        data,
      })
      .run()
    const owner = yield* BrowserOwner.open(ctx)
    yield* Effect.promise(() => owner.approve(provider))
    return { ctx, owner }
  })
}

class Clock {
  now = Date.now()
  timers = new Map<unknown, { at: number; fn: () => void }>()
  setTimeout(fn: () => void, ms = 0) {
    const id = {}
    this.timers.set(id, { at: this.now + ms, fn })
    return id
  }
  clearTimeout(id: unknown) {
    this.timers.delete(id)
  }
  async advance(ms: number) {
    const end = this.now + ms
    for (;;) {
      for (let n = 0; n < 30; n++) await Promise.resolve()
      const next = [...this.timers]
        .filter(([, timer]) => timer.at <= end)
        .sort((a, b) => a[1].at - b[1].at)
        .at(0)
      if (!next) {
        this.now = end
        return
      }
      this.now = next[1].at
      this.timers.delete(next[0])
      next[1].fn()
    }
  }
}

function link(clock = new Clock()) {
  const requests: Request[] = []
  const unread: Request[] = []
  const waiting = new Map<string, (request: Request) => void>()
  const updates: BrowserClient.Output[] = []
  const controller = new AbortController()
  const connection = {
    connected: true,
    heartbeat: async () => {},
    send(message: RemoteProtocol.OutboundWithBrowser) {
      if (message.type !== "browser_request" || !connection.connected) return false
      requests.push(message)
      const resolve = waiting.get(message.operation)
      if (resolve) {
        waiting.delete(message.operation)
        resolve(message)
      } else unread.push(message)
      return true
    },
  }
  const client = BrowserClient.create(() => connection, { timers: clock, now: () => clock.now })
  const hooks = {
    signal: controller.signal,
    metadata: async (value: BrowserClient.Output) => {
      updates.push(value)
    },
  }
  const negotiate = () => client.handle({ type: "heartbeat_ack", capabilities: { browserJobsV1: true } })
  const reply = (request: Request, response: RemoteProtocol.BrowserResponse["response"]) =>
    client.handle(
      RemoteProtocol.BrowserResponse.parse({ type: "browser_response", requestId: request.requestId, response }),
    )
  function next(operation: Request["operation"]) {
    const index = unread.findIndex((request) => request.operation === operation)
    if (index !== -1) return Promise.resolve(unread.splice(index, 1).at(0)!)
    return new Promise<Request>((resolve) => waiting.set(operation, resolve))
  }
  negotiate()
  return { client, connection, requests, updates, controller, hooks, clock, negotiate, reply, next }
}

async function snapshot(owner: Owner, request: Request): Promise<RemoteProtocol.BrowserJobSnapshot> {
  if (request.operation !== "invoke") throw new Error("Expected an invocation")
  const intent = (await owner.recover()).find((record) => record.invocationId === request.invocationId)
  if (!intent) throw new Error("Dispatch occurred before durable intent publication")
  const created = Number(request.invocationId.split(".").at(1))
  // The relay hashes JSON fields, including the authenticated user and proof digest, not the local intent hash.
  const hash = (fields: string[]) => createHash("sha256").update(JSON.stringify(fields)).digest("hex")
  return RemoteProtocol.BrowserJobSnapshot.parse({
    providerId: request.providerId,
    browserTaskId: request.browserTaskId ?? `bt_${crypto.randomUUID()}`,
    jobId: `bj_${crypto.randomUUID()}`,
    invocationId: request.invocationId,
    payloadFingerprint: hash([
      "user_1",
      request.owner.parentSessionId,
      hash([request.owner.parentProof]),
      request.providerId,
      request.browserTaskId ?? "",
      request.goal,
    ]),
    generation: 1,
    status: "queued",
    createdAt: new Date(created).toISOString(),
    expiresAt: new Date(created + 604_800_000).toISOString(),
    deadlines: { queue: new Date(created + 600_000).toISOString() },
  })
}

function completed(
  job: RemoteProtocol.BrowserJobSnapshot,
  summary = "The page title is Example Domain.",
): RemoteProtocol.BrowserJobSnapshot {
  return RemoteProtocol.BrowserJobSnapshot.parse({
    ...job,
    status: "succeeded",
    result: {
      providerId: job.providerId,
      browserTaskId: job.browserTaskId,
      jobId: job.jobId,
      invocationId: job.invocationId,
      status: "succeeded",
      reason: "completed",
      effectsUncertain: false,
      summary,
      evidence: [{ title: "Example Domain", url: "https://example.com" }],
    },
  })
}

function ack(
  wire: ReturnType<typeof link>,
  request: Request,
  job: RemoteProtocol.BrowserJobSnapshot,
  operation: "invoke" | "cancel" = "invoke",
) {
  wire.reply(request, {
    kind: "ack",
    operation,
    providerId: job.providerId,
    browserTaskId: job.browserTaskId,
    jobId: job.jobId,
    invocationId: job.invocationId,
  })
}

async function finish(wire: ReturnType<typeof link>, job: RemoteProtocol.BrowserJobSnapshot) {
  const request = await wire.next("status")
  wire.reply(request, { kind: "status", job: completed(job) })
}

describe("browser client delivery", () => {
  test("requires negotiation, exposes empty discovery, and never dispatches list work", async () => {
    const wire = link()
    wire.client.open()
    const pending = wire.client.list(wire.controller.signal)
    await wire.clock.advance(4_999)
    expect(wire.requests).toEqual([])
    wire.negotiate()
    const request = await wire.next("list")
    wire.reply(request, { kind: "providers", providers: [] })
    const result = await pending
    expect(result.providers).toEqual([])
    expect(result.summary).toContain("Enable CLI tasks")
    expect(result.summary).toContain("panel open")
    expect(wire.requests.map((request) => request.operation)).toEqual(["list"])
    expect(wire.clock.timers.size).toBe(0)
  })

  test("rejects a legacy relay without sending a browser request", async () => {
    const wire = link()
    wire.client.handle({ type: "heartbeat_ack" })
    expect(await wire.client.list(wire.controller.signal).catch((err: unknown) => err)).toMatchObject({
      data: { code: "unsupported", retryable: false },
    })
    expect(wire.requests).toEqual([])
  })

  it.live("persists accepted IDs through metadata before status and returns the owned result", () =>
    Effect.gen(function* () {
      const { owner } = yield* seed()
      yield* Effect.promise(async () => {
        const wire = link()
        const pending = wire.client.run(owner, input, wire.hooks)
        const request = await wire.next("invoke")
        const job = await snapshot(owner, request)
        ack(wire, request, job)
        const status = await wire.next("status")
        expect((await owner.recover()).at(0)?.handle?.jobId).toBe(job.jobId)
        expect(wire.updates.at(0)).toMatchObject({
          status: "accepted",
          browser_task_id: job.browserTaskId,
          job_id: job.jobId,
        })
        wire.reply(status, { kind: "status", job: completed(job) })
        expect(await pending).toMatchObject({
          status: "succeeded",
          reason: "completed",
          summary: "The page title is Example Domain.",
          evidence: [{ title: "Example Domain", url: "https://example.com" }],
          browser_task_id: job.browserTaskId,
          job_id: job.jobId,
          effectsUncertain: false,
        })
        expect(wire.clock.timers.size).toBe(0)
      })
    }),
  )

  it.live("retains accepted identity after failed handle persistence and recovers only the original intent", () =>
    Effect.gen(function* () {
      const { ctx, owner } = yield* seed()
      const wire = link()
      const job = yield* Effect.promise(async () => {
        const pending = wire.client.run(owner, input, wire.hooks)
        const request = await wire.next("invoke")
        const job = await snapshot(owner, request)
        const dir = path.join(Global.Path.data, "browser-owner", ctx.sessionID)
        await fs.rename(dir, `${dir}.unavailable`)
        try {
          ack(wire, request, job)
          const result = await pending
          expect(result).toMatchObject({
            status: "interrupted",
            reason: "delivery_interrupted",
            provider_id: provider,
            browser_task_id: job.browserTaskId,
            job_id: job.jobId,
            invocation_id: job.invocationId,
            effectsUncertain: true,
            retryable: true,
            evidence: [],
          })
          expect(result.summary).toContain("accepted")
          expect(result.summary).toContain("persistence failed")
          expect(result.summary).toContain("does not establish browser failure")
          expect(result.guidance).toContain("Once private browser storage is available")
          expect(result.guidance).toContain("operation=recover")
          expect(result.guidance).toContain("without replay")
          expect(result.guidance).toContain("Do not automatically repeat operation=run")
          expect(wire.requests.map((request) => request.operation)).toEqual(["invoke"])
          expect(wire.clock.timers.size).toBe(0)
        } finally {
          await fs.rename(`${dir}.unavailable`, dir)
        }
        expect((await owner.recover()).at(0)?.handle).toBeUndefined()
        return job
      })
      const reopened = yield* BrowserOwner.open({ ...ctx, callID: "recover-after-storage-failure" })
      yield* Effect.promise(async () => {
        const pending = wire.client.recover(reopened, wire.hooks)
        const request = await wire.next("recover")
        const first = wire.requests.at(0)
        if (request.operation !== "recover" || first?.operation !== "invoke")
          throw new Error("Expected lookup after acceptance")
        expect(request.invocationId).toBe(owner.invocationId)
        expect(request.owner).toEqual(first.owner)
        wire.reply(request, { kind: "recovered", job: completed(job) })
        expect(await pending).toMatchObject({
          status: "recovered",
          jobs: [{ status: "succeeded", job_id: job.jobId, invocation_id: owner.invocationId }],
        })
        expect((await reopened.recover()).at(0)?.handle?.jobId).toBe(job.jobId)
        expect(wire.requests.map((request) => request.operation)).toEqual(["invoke", "recover"])
        expect(wire.clock.timers.size).toBe(0)
      })
    }),
  )

  it.live("preserves authoritative terminal facts when recovered handle persistence fails", () =>
    Effect.gen(function* () {
      const { ctx, owner } = yield* seed()
      yield* Effect.promise(async () => {
        await owner.prepare(input)
        const wire = link()
        const pending = wire.client.recover(owner, wire.hooks)
        const request = await wire.next("recover")
        if (request.operation !== "recover") throw new Error("Expected recovery")
        const job = completed(await snapshot(owner, { ...request, operation: "invoke", ...input }))
        const dir = path.join(Global.Path.data, "browser-owner", ctx.sessionID)
        await fs.rename(dir, `${dir}.unavailable`)
        try {
          wire.reply(request, { kind: "recovered", job })
          const result = await pending
          expect(result).toMatchObject({
            status: "recovered",
            effectsUncertain: false,
            jobs: [
              {
                status: "succeeded",
                reason: "completed",
                browser_task_id: job.browserTaskId,
                job_id: job.jobId,
                invocation_id: owner.invocationId,
                evidence: [{ title: "Example Domain", url: "https://example.com" }],
                effectsUncertain: false,
              },
            ],
          })
          expect(result.jobs?.at(0)?.summary).toContain("The page title is Example Domain.")
          expect(result.jobs?.at(0)?.summary).toContain("persistence failed")
          expect(result.jobs?.at(0)?.guidance).toContain("operation=recover")
          expect(wire.requests.map((request) => request.operation)).toEqual(["recover"])
          expect(wire.clock.timers.size).toBe(0)
        } finally {
          await fs.rename(`${dir}.unavailable`, dir)
        }
      })
    }),
  )

  it.live("recovers a lost acknowledgement without sending another invocation", () =>
    Effect.gen(function* () {
      const { owner } = yield* seed()
      yield* Effect.promise(async () => {
        const wire = link()
        const pending = wire.client.run(owner, input, wire.hooks)
        const request = await wire.next("invoke")
        const job = completed(await snapshot(owner, request))
        await wire.clock.advance(10_000)
        const lookup = await wire.next("recover")
        expect(lookup).toMatchObject({ invocationId: job.invocationId })
        wire.reply(lookup, { kind: "recovered", job })
        expect((await pending).summary).toBe(job.result!.summary)
        expect(wire.requests.filter((request) => request.operation === "invoke")).toHaveLength(1)
      })
    }),
  )

  it.live("retries only the stored invocation and unchanged payload after authoritative not-found", () =>
    Effect.gen(function* () {
      const { owner } = yield* seed()
      yield* Effect.promise(async () => {
        const wire = link()
        const pending = wire.client.run(owner, input, wire.hooks)
        const first = await wire.next("invoke")
        wire.client.disconnect()
        wire.client.open()
        wire.negotiate()
        const lookup = await wire.next("recover")
        wire.reply(lookup, { kind: "not_found", invocationId: owner.invocationId })
        await wire.clock.advance(1_000)
        const second = await wire.next("invoke")
        expect(second).toMatchObject({
          operation: "invoke",
          invocationId: owner.invocationId,
          providerId: provider,
          goal: input.goal,
        })
        expect({ ...second, requestId: first.requestId }).toEqual(first)
        const job = await snapshot(owner, second)
        ack(wire, second, job)
        await finish(wire, job)
        expect((await pending).status).toBe("succeeded")
      })
    }),
  )

  it.live("reconnects after acceptance with status only and waits beyond a short command timeout", () =>
    Effect.gen(function* () {
      const { owner } = yield* seed()
      yield* Effect.promise(async () => {
        const wire = link()
        const pending = wire.client.run(owner, input, wire.hooks)
        const request = await wire.next("invoke")
        const job = await snapshot(owner, request)
        ack(wire, request, job)
        for (let n = 0; n < 35; n++) {
          wire.reply(await wire.next("status"), { kind: "status", job })
          await wire.clock.advance(1_000)
        }
        await wire.next("status")
        wire.client.disconnect()
        wire.connection.connected = false
        await wire.clock.advance(20_000)
        const before = wire.requests.length
        wire.connection.connected = true
        wire.client.open()
        await wire.clock.advance(1_000)
        expect(wire.requests).toHaveLength(before)
        wire.negotiate()
        await finish(wire, job)
        expect((await pending).status).toBe("succeeded")
        expect(wire.requests.filter((request) => request.operation === "invoke")).toHaveLength(1)
      })
    }),
  )

  it.live("retains known IDs and recovery guidance when owned status delivery is interrupted", () =>
    Effect.gen(function* () {
      const { owner } = yield* seed()
      yield* Effect.promise(async () => {
        const wire = link()
        const pending = wire.client.run(owner, input, wire.hooks)
        const request = await wire.next("invoke")
        const job = await snapshot(owner, request)
        ack(wire, request, job)
        await finish(wire, job)
        await pending
        const polling = wire.client.status(owner, job.browserTaskId, job.jobId, wire.hooks)
        await wire.next("status")
        await wire.clock.advance(30_000)
        const result = await polling
        expect(result).toMatchObject({
          status: "interrupted",
          reason: "delivery_interrupted",
          browser_task_id: job.browserTaskId,
          job_id: job.jobId,
          effectsUncertain: true,
        })
        expect(result.guidance).toContain("operation=recover")
        expect(result.summary).toContain("does not establish browser failure")
        expect(wire.requests.filter((request) => request.operation === "invoke")).toHaveLength(1)
        expect(wire.clock.timers.size).toBe(0)
      })
    }),
  )

  it.live("bounds lost acceptance recovery at thirty seconds and retains the intent", () =>
    Effect.gen(function* () {
      const { owner } = yield* seed()
      yield* Effect.promise(async () => {
        const wire = link()
        const pending = wire.client.run(owner, input, wire.hooks)
        await wire.next("invoke")
        await wire.clock.advance(30_000)
        const result = await pending
        expect(result).toMatchObject({
          status: "interrupted",
          reason: "delivery_interrupted",
          invocation_id: owner.invocationId,
          effectsUncertain: true,
        })
        expect(result.summary).toContain("does not establish browser failure")
        expect(result.guidance).toContain("operation=recover")
        expect(wire.requests.filter((request) => request.operation === "invoke")).toHaveLength(1)
        expect((await owner.recover()).at(0)?.handle).toBeUndefined()
        expect(wire.clock.timers.size).toBe(0)
      })
    }),
  )

  it.live("uses progress and result events only for their exact parent and job", () =>
    Effect.gen(function* () {
      const first = yield* seed()
      const second = yield* seed()
      yield* Effect.promise(async () => {
        const wire = link()
        const left = wire.client.run(first.owner, input, wire.hooks)
        const one = await wire.next("invoke")
        const a = await snapshot(first.owner, one)
        const other = { signal: new AbortController().signal, metadata: async (_value: BrowserClient.Output) => {} }
        const right = wire.client.run(second.owner, input, other)
        const two = await wire.next("invoke")
        const b = await snapshot(second.owner, two)
        ack(wire, one, a)
        const sa = await wire.next("status")
        ack(wire, two, b)
        const sb = await wire.next("status")
        wire.client.handle({
          type: "browser_event",
          requestId: one.requestId,
          event: "result",
          result: completed(b, "Foreign secret").result!,
        })
        wire.client.handle({
          type: "browser_event",
          requestId: crypto.randomUUID(),
          event: "result",
          result: completed(a, "Uncorrelated secret").result!,
        })
        wire.client.handle({
          type: "browser_event",
          requestId: one.requestId,
          event: "progress",
          job: { ...a, status: "awaiting_approval" },
        })
        wire.client.handle({
          type: "browser_event",
          requestId: one.requestId,
          event: "result",
          result: completed(a, "First parent").result!,
        })
        wire.client.handle({
          type: "browser_event",
          requestId: two.requestId,
          event: "result",
          result: completed(b, "Second parent").result!,
        })
        wire.reply(sa, { kind: "status", job: a })
        wire.reply(sb, { kind: "status", job: b })
        expect((await left).summary).toBe("First parent")
        expect((await right).summary).toBe("Second parent")
        const count = wire.updates.length
        wire.client.handle({
          type: "browser_event",
          requestId: one.requestId,
          event: "result",
          result: completed(a, "Late secret").result!,
        })
        expect(wire.updates).toHaveLength(count)
        expect(JSON.stringify(wire.updates)).not.toContain("secret")
      })
    }),
  )

  it.live("delivers relay progress despite its different payload fingerprint", () =>
    Effect.gen(function* () {
      const { owner } = yield* seed()
      yield* Effect.promise(async () => {
        const wire = link()
        const pending = wire.client.run(owner, input, wire.hooks)
        const request = await wire.next("invoke")
        const job = await snapshot(owner, request)
        expect(job.payloadFingerprint).not.toBe((await owner.recover()).at(0)?.payloadFingerprint)
        ack(wire, request, job)
        wire.reply(await wire.next("status"), { kind: "status", job })
        await wire.clock.advance(0)
        wire.client.handle({
          type: "browser_event",
          requestId: request.requestId,
          event: "progress",
          job: { ...job, status: "awaiting_approval" },
        })
        await wire.clock.advance(0)
        expect(wire.updates.at(-1)).toMatchObject({
          status: "awaiting_approval",
          browser_task_id: job.browserTaskId,
          job_id: job.jobId,
          invocation_id: job.invocationId,
        })
        wire.client.handle({
          type: "browser_event",
          requestId: request.requestId,
          event: "result",
          result: completed(job).result!,
        })
        expect((await pending).summary).toBe("The page title is Example Domain.")
        expect(wire.clock.timers.size).toBe(0)
      })
    }),
  )

  for (const [key, value] of [
    ["providerId", `bp_${crypto.randomUUID()}`],
    ["browserTaskId", `bt_${crypto.randomUUID()}`],
    ["jobId", `bj_${crypto.randomUUID()}`],
    ["invocationId", `b1.${Date.now()}.${"f".repeat(64)}`],
  ] as const) {
    it.live(`rejects a mismatched ${key} in status and recovery snapshots`, () =>
      Effect.gen(function* () {
        const { owner } = yield* seed()
        yield* Effect.promise(async () => {
          const wire = link()
          const pending = wire.client.run(owner, input, wire.hooks)
          const request = await wire.next("invoke")
          const job = await snapshot(owner, request)
          ack(wire, request, job)
          await finish(wire, job)
          await pending
          const count = wire.updates.length
          const foreign = completed({ ...job, [key]: value }, "Foreign secret")
          const polling = wire.client.status(owner, job.browserTaskId, job.jobId, wire.hooks)
          wire.reply(await wire.next("status"), { kind: "status", job: foreign })
          expect(await polling.catch((err: unknown) => err)).toMatchObject({ data: { code: "invalid_response" } })
          const recovery = wire.client.recover(owner, wire.hooks)
          wire.reply(await wire.next("recover"), { kind: "recovered", job: foreign })
          expect(await recovery).toMatchObject({ jobs: [{ status: "rejected", reason: "invalid_response" }] })
          expect(wire.updates).toHaveLength(count)
          expect(JSON.stringify(wire.updates)).not.toContain("Foreign secret")
          expect((await owner.recover()).at(0)?.handle?.jobId).toBe(job.jobId)
        })
      }),
    )
  }

  it.live("rejects a changed goal locally before retrying the stored invocation", () =>
    Effect.gen(function* () {
      const { owner } = yield* seed()
      yield* Effect.promise(async () => {
        const wire = link()
        const pending = wire.client.run(owner, input, wire.hooks)
        const request = await wire.next("invoke")
        const job = await snapshot(owner, request)
        ack(wire, request, job)
        await finish(wire, job)
        await pending
        const saved = await owner.recover()
        const count = wire.requests.length
        expect(
          await wire.client.run(owner, { ...input, goal: "Changed goal" }, wire.hooks).catch((err: unknown) => err),
        ).toMatchObject({ data: { code: "invocation_conflict", retryable: false } })
        expect(wire.requests).toHaveLength(count)
        expect(await owner.recover()).toEqual(saved)
      })
    }),
  )

  it.live("rejects a mismatched acknowledgement without persisting or returning its handle", () =>
    Effect.gen(function* () {
      const { owner } = yield* seed()
      yield* Effect.promise(async () => {
        const wire = link()
        const pending = wire.client.run(owner, input, wire.hooks)
        const request = await wire.next("invoke")
        const job = await snapshot(owner, request)
        ack(wire, request, { ...job, invocationId: `b1.${Date.now()}.${"f".repeat(64)}` })
        expect(await pending.catch((err: unknown) => err)).toMatchObject({ data: { code: "invalid_response" } })
        expect(wire.updates).toEqual([])
        expect((await owner.recover()).at(0)?.handle).toBeUndefined()
      })
    }),
  )

  it.live("sends cancellation on abort but does not mistake its acknowledgement for a terminal result", () =>
    Effect.gen(function* () {
      const { owner } = yield* seed()
      yield* Effect.promise(async () => {
        const wire = link()
        const pending = wire.client.run(owner, input, wire.hooks)
        const request = await wire.next("invoke")
        const job = await snapshot(owner, request)
        ack(wire, request, job)
        await wire.next("status")
        wire.controller.abort()
        const cancel = await wire.next("cancel")
        expect(cancel).toMatchObject({ browserTaskId: job.browserTaskId, jobId: job.jobId })
        ack(wire, cancel, job, "cancel")
        const status = await wire.next("status")
        const result = {
          ...completed(job).result!,
          status: "cancelled" as const,
          reason: "cancelled" as const,
          effectsUncertain: true,
          summary: "Stopped future actions; issued actions are not undone.",
          evidence: [],
        }
        wire.reply(status, { kind: "status", job: { ...job, status: "cancelled", result } })
        expect(await pending).toMatchObject({
          status: "cancelled",
          reason: "cancelled",
          effectsUncertain: true,
          evidence: [],
        })
        expect(wire.clock.timers.size).toBe(0)
      })
    }),
  )

  it.live("releases the tool within ten seconds when cancellation delivery also drops", () =>
    Effect.gen(function* () {
      const { owner } = yield* seed()
      yield* Effect.promise(async () => {
        const wire = link()
        const pending = wire.client.run(owner, input, wire.hooks)
        const request = await wire.next("invoke")
        const job = await snapshot(owner, request)
        ack(wire, request, job)
        await wire.next("status")
        wire.controller.abort()
        await wire.next("cancel")
        await wire.clock.advance(10_000)
        expect(await pending).toMatchObject({
          status: "interrupted",
          reason: "delivery_interrupted",
          browser_task_id: job.browserTaskId,
          job_id: job.jobId,
          effectsUncertain: true,
        })
        expect(wire.clock.timers.size).toBe(0)
      })
    }),
  )

  it.live("surfaces recovered prior jobs before allowing a new run", () =>
    Effect.gen(function* () {
      const { ctx, owner } = yield* seed()
      yield* Effect.promise(() => owner.prepare(input))
      const next = yield* BrowserOwner.open({ ...ctx, callID: "new-run" })
      yield* Effect.promise(async () => {
        const wire = link()
        const pending = wire.client.run(next, { ...input, goal: "New goal" }, wire.hooks)
        const request = await wire.next("recover")
        if (request.operation !== "recover") throw new Error("Expected recovery before submission")
        expect(request.invocationId).toBe(owner.invocationId)
        const job = completed(await snapshot(owner, { ...request, operation: "invoke", ...input }))
        wire.reply(request, { kind: "recovered", job })
        expect(await pending).toMatchObject({
          status: "recovery_required",
          jobs: [{ invocation_id: owner.invocationId, status: "succeeded" }],
        })
        expect(wire.requests.map((request) => request.operation)).toEqual(["recover"])
        expect(await next.recover()).toHaveLength(1)
      })
    }),
  )

  it.live("permits a new explicit goal after rejection and authoritative not-found recovery", () =>
    Effect.gen(function* () {
      const { ctx, owner } = yield* seed()
      yield* Effect.promise(async () => {
        const wire = link()
        const pending = wire.client.run(owner, input, wire.hooks)
        wire.reply(await wire.next("invoke"), {
          kind: "error",
          code: "provider_unavailable",
          retryable: true,
          message: "Provider unavailable",
        })
        expect(await pending.catch((err: unknown) => err)).toMatchObject({
          data: { code: "provider_unavailable", retryable: true },
        })
        const recovery = wire.client.recover(owner, wire.hooks)
        wire.reply(await wire.next("recover"), { kind: "not_found", invocationId: owner.invocationId })
        const result = await recovery
        expect(result).toMatchObject({ jobs: [{ status: "not_found", invocation_id: owner.invocationId }] })
        expect(wire.requests.map((request) => request.operation)).toEqual(["invoke", "recover"])
        wire.client.close()
      })
      const saved = yield* Effect.promise(() => owner.recover())
      const next = yield* BrowserOwner.open({ ...ctx, callID: "new-run" })
      yield* Effect.promise(async () => {
        const wire = link()
        const pending = wire.client.run(next, { ...input, goal: "New goal" }, wire.hooks)
        const lookup = await wire.next("recover")
        expect(lookup).toMatchObject({ invocationId: owner.invocationId })
        wire.reply(lookup, { kind: "not_found", invocationId: owner.invocationId })
        const request = await Promise.race([wire.next("invoke"), pending])
        expect(request).toMatchObject({
          operation: "invoke",
          invocationId: next.invocationId,
          providerId: provider,
          goal: "New goal",
        })
        if (!("operation" in request)) throw new Error("The explicit new run did not submit")
        const job = await snapshot(next, request)
        ack(wire, request, job)
        await finish(wire, job)
        expect(await pending).toMatchObject({ status: "succeeded", invocation_id: next.invocationId })
        expect(wire.requests.map((request) => request.operation)).toEqual(["recover", "invoke", "status"])
        expect((await owner.recover()).find((record) => record.invocationId === owner.invocationId)).toEqual(
          saved.at(0),
        )
        expect(wire.clock.timers.size).toBe(0)
      })
    }),
  )

  for (const code of ["delivery_interrupted", "invalid_response", "owner_mismatch"] as const) {
    it.live(`blocks a new goal when prior recovery returns ${code}`, () =>
      Effect.gen(function* () {
        const { ctx, owner } = yield* seed()
        yield* Effect.promise(() => owner.prepare(input))
        const next = yield* BrowserOwner.open({ ...ctx, callID: "new-run" })
        yield* Effect.promise(async () => {
          const wire = link()
          const saved = await owner.recover()
          const pending = wire.client.run(next, { ...input, goal: "New goal" }, wire.hooks)
          const request = await wire.next("recover")
          if (code === "delivery_interrupted") await wire.clock.advance(30_000)
          if (code === "invalid_response") wire.reply(request, { kind: "not_found", invocationId: next.invocationId })
          if (code === "owner_mismatch")
            wire.reply(request, { kind: "error", code, retryable: false, message: "Wrong owner" })
          const result = await pending
          expect(result).toMatchObject({
            status: "recovery_required",
            jobs: [
              {
                status: code === "delivery_interrupted" ? "interrupted" : "rejected",
                reason: code,
                invocation_id: owner.invocationId,
              },
            ],
          })
          expect(result.guidance).toContain("operation=recover")
          expect(wire.requests.every((request) => request.operation === "recover")).toBe(true)
          expect(await next.recover()).toEqual(saved)
          expect(wire.clock.timers.size).toBe(0)
        })
      }),
    )
  }

  it.live("continues only the owned conversation and sends only its new goal", () =>
    Effect.gen(function* () {
      const { ctx, owner } = yield* seed()
      yield* Effect.promise(async () => {
        const wire = link()
        const pending = wire.client.run(owner, input, wire.hooks)
        const request = await wire.next("invoke")
        const job = await snapshot(owner, request)
        ack(wire, request, job)
        await finish(wire, job)
        await pending
      })
      const next = yield* BrowserOwner.open({ ...ctx, callID: "continue" })
      yield* Effect.promise(async () => {
        const wire = link()
        const task = (await next.recover()).at(0)!.handle!.browserTaskId
        const pending = wire.client.run(next, { ...input, browserTaskId: task, goal: "Read the next page" }, wire.hooks)
        const request = await wire.next("invoke")
        expect(request).toMatchObject({
          browserTaskId: task,
          providerId: provider,
          goal: "Read the next page",
          invocationId: next.invocationId,
        })
        expect(Object.keys(request).sort()).toEqual([
          "browserTaskId",
          "goal",
          "invocationId",
          "operation",
          "owner",
          "providerId",
          "requestId",
          "type",
        ])
        const job = await snapshot(next, request)
        ack(wire, request, job)
        await finish(wire, job)
        expect((await pending).browser_task_id).toBe(task)
      })
    }),
  )

  it.live("returns empty recovery without a network request", () =>
    Effect.gen(function* () {
      const { owner } = yield* seed()
      yield* Effect.promise(async () => {
        const wire = link()
        const result = await wire.client.recover(owner, wire.hooks)
        expect(result).toMatchObject({ status: "empty", jobs: [], evidence: [] })
        expect(result.guidance).toContain("operation=list")
        expect(result.guidance).toContain("operation=run")
        expect(result.guidance).toContain("provider_id")
        expect(result.provider_id).toBeUndefined()
        expect(wire.requests).toEqual([])
      })
    }),
  )

  for (const [code, retryable] of [
    ["provider_unavailable", true],
    ["capacity_exceeded", true],
    ["conversation_busy", true],
    ["invocation_expired", false],
    ["invocation_conflict", false],
    ["owner_mismatch", false],
  ] as const) {
    it.live(`preserves ${code} without replay`, () =>
      Effect.gen(function* () {
        const { owner } = yield* seed()
        yield* Effect.promise(async () => {
          const wire = link()
          const pending = wire.client.run(owner, input, wire.hooks)
          wire.reply(await wire.next("invoke"), { kind: "error", code, retryable, message: "Relay rejection" })
          expect(await pending.catch((err: unknown) => err)).toMatchObject({ data: { code, retryable } })
          expect(wire.requests.map((request) => request.operation)).toEqual(["invoke"])
          expect(wire.clock.timers.size).toBe(0)
        })
      }),
    )
  }
})

it.live(
  "recovers after process death between accepted dispatch and any acknowledgement or handle persistence",
  () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      const database = path.join(tmp.path, "browser-restart.db")
      yield* Effect.gen(function* () {
        const { ctx, owner } = yield* seed()
        yield* Effect.promise(async () => {
          const accepted = Promise.withResolvers<Request>()
          const requests: Request[] = []
          let job: RemoteProtocol.BrowserJobSnapshot | undefined
          const server = Bun.serve({
            hostname: "127.0.0.1",
            port: 0,
            fetch(request, server) {
              return server.upgrade(request) ? undefined : new Response("Not found", { status: 404 })
            },
            websocket: {
              message(socket, raw) {
                const message = RemoteProtocol.OutboundWithBrowser.parse(JSON.parse(String(raw)))
                if (message.type === "heartbeat") {
                  socket.send(JSON.stringify({ type: "heartbeat_ack", capabilities: { browserJobsV1: true } }))
                  return
                }
                if (message.type !== "browser_request") return
                requests.push(message)
                if (message.operation === "invoke") {
                  accepted.resolve(message)
                  return
                }
                if (message.operation !== "recover" || !job)
                  throw new Error("Restart must recover the retained invocation")
                socket.send(
                  JSON.stringify({
                    type: "browser_response",
                    requestId: message.requestId,
                    response: { kind: "recovered", job },
                  }),
                )
              },
            },
          })
          const program = `
        import { Effect } from "effect"
        import { Database } from "@opencode-ai/core/database/database"
        import { Global } from "@opencode-ai/core/global"
        import { BrowserOwner } from ${JSON.stringify(new URL("../../../src/kilocode/browser-task/owner.ts", import.meta.url).href)}
        import { BrowserClient } from ${JSON.stringify(new URL("../../../src/kilocode/browser-task/client.ts", import.meta.url).href)}
        import { RemoteWS } from ${JSON.stringify(new URL("../../../src/kilo-sessions/remote-ws.ts", import.meta.url).href)}
        const mode = process.argv[1]
        Global.Path.data = ${JSON.stringify(Global.Path.data)}
        const ctx = ${JSON.stringify({ sessionID: ctx.sessionID, messageID: ctx.messageID, callID: ctx.callID })}
        if (mode === "recover") ctx.callID = "after-process-death"
        const owner = await Effect.runPromise(BrowserOwner.open(ctx).pipe(Effect.provide(Database.layerFromPath(${JSON.stringify(database)}))))
        await owner.approve(${JSON.stringify(provider)})
        const client = BrowserClient.create(() => connection)
        const connection = RemoteWS.connect({ url: ${JSON.stringify(`ws://127.0.0.1:${server.port}`)}, getToken: async () => "test-token", getSessions: async () => ({ sessions: [] }), log: { info() {}, warn() {}, error() {} }, onOpen: () => client.open(), onDisconnect: () => client.disconnect(), onMessage: (message) => { if (message.type === "heartbeat_ack") client.handle(message) }, onBrowserMessage: (message) => client.handle(message), onClose: () => client.close() })
        const hooks = { signal: new AbortController().signal, metadata: async () => {} }
        const result = mode === "run" ? await client.run(owner, ${JSON.stringify(input)}, hooks) : await client.recover(owner, hooks)
        console.log("BROWSER_RESULT " + JSON.stringify(result))
        client.close()
        connection.close()
        process.exit(0)
      `
          const spawn = (mode: string) =>
            Bun.spawn([process.execPath, "--eval", program, mode], {
              cwd: path.resolve(import.meta.dir, "../../.."),
              stdout: "pipe",
              stderr: "pipe",
              windowsHide: true,
            })
          const child = spawn("run")
          try {
            const request = await Promise.race([
              accepted.promise,
              child.exited.then(async (code) => {
                throw new Error(`Child exited before dispatch (${code}): ${await new Response(child.stderr).text()}`)
              }),
            ])
            job = completed(await snapshot(owner, request))
            child.kill()
            await child.exited
            expect((await owner.recover()).at(0)?.handle).toBeUndefined()
            const restarted = spawn("recover")
            try {
              const [code, text, error] = await Promise.all([
                restarted.exited,
                new Response(restarted.stdout).text(),
                new Response(restarted.stderr).text(),
              ])
              expect(error).not.toContain("BrowserClientError")
              expect(code).toBe(0)
              const result = text.split(/\r?\n/).find((line) => line.startsWith("BROWSER_RESULT "))
              expect(result).toBeDefined()
              expect(JSON.parse(result!.slice("BROWSER_RESULT ".length)).jobs).toMatchObject([
                { status: "succeeded", browser_task_id: job.browserTaskId, job_id: job.jobId },
              ])
              expect(requests.map((request) => request.operation)).toEqual(["invoke", "recover"])
              expect((await owner.recover()).at(0)?.handle?.jobId).toBe(job.jobId)
              expect(
                await fs.readFile(
                  path.join(Global.Path.data, "browser-owner", ctx.sessionID, `intent-${job.invocationId}.json`),
                  "utf8",
                ),
              ).not.toContain(input.goal)
            } finally {
              restarted.kill()
            }
          } finally {
            child.kill()
            await server.stop(true)
          }
        })
      }).pipe(Effect.provide(Layer.fresh(Database.layerFromPath(database))))
    }),
  30_000,
)
