import { afterEach, describe, expect, mock, spyOn } from "bun:test"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Global } from "@opencode-ai/core/global"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { MessageTable, SessionTable } from "@opencode-ai/core/session/sql"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { run as sandbox, type Profile } from "@kilocode/sandbox"
import { Cause, Effect, Exit, Fiber, Layer } from "effect"
import { Agent } from "../../../src/agent/agent"
import { Config } from "../../../src/config/config"
import { RuntimeFlags } from "../../../src/effect/runtime-flags"
import { KiloSessions } from "../../../src/kilo-sessions/kilo-sessions"
import { RemoteProtocol } from "../../../src/kilo-sessions/remote-protocol"
import { BrowserClient } from "../../../src/kilocode/browser-task/client"
import { BrowserOwner } from "../../../src/kilocode/browser-task/owner"
import * as Network from "../../../src/kilocode/sandbox/network"
import { BrowserTaskTool } from "../../../src/kilocode/tool/browser-task"
import { MessageID, SessionID } from "../../../src/session/schema"
import { Tool } from "../../../src/tool/tool"
import { ToolRegistry } from "../../../src/tool/registry"
import * as Truncate from "../../../src/tool/truncate"
import { TestConfig } from "../../fixture/config"
import { testEffect } from "../../lib/effect"

const provider = "bp_00000000-0000-4000-8000-000000000001"
const task = "bt_00000000-0000-4000-8000-000000000002"
const args = { operation: "run", provider_id: provider, goal: "Read this page" } as const
const layer = Layer.mergeAll(
  Database.layerFromPath(":memory:"),
  Layer.mock(Agent.Service, {
    get: () => Effect.succeed({ name: "test", mode: "primary", permission: [], options: {} } satisfies Agent.Info),
  }),
  Layer.mock(Truncate.Service, { output: (text) => Effect.succeed({ content: text, truncated: false }) }),
)
const it = testEffect(layer)
const denied: Profile = {
  filesystem: { allowWrite: [], denyWrite: [], denyNames: [] },
  network: { mode: "deny", allowedHosts: [] },
  environment: { deny: [], set: {} },
}
afterEach(() => mock.restore())

function context(): Tool.Context {
  return {
    sessionID: SessionID.make(`ses_${crypto.randomUUID()}`),
    messageID: MessageID.ascending(),
    callID: crypto.randomUUID(),
    agent: "test",
    abort: new AbortController().signal,
    messages: [],
    ask: () => Effect.void,
    metadata: () => Effect.void,
  }
}

function seed(ctx: Tool.Context) {
  return Effect.gen(function* () {
    const db = yield* Database.Service
    const project = ProjectV2.ID.make("c".repeat(40))
    yield* db.db
      .insert(ProjectTable)
      .values({ id: project, worktree: AbsolutePath.make(Global.Path.data), sandboxes: [] })
      .onConflictDoNothing()
      .run()
    yield* db.db
      .insert(SessionTable)
      .values({
        id: ctx.sessionID,
        project_id: project,
        slug: "browser-tool",
        directory: AbsolutePath.make(Global.Path.data),
        title: "Browser tool",
        version: "test",
      })
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
        session_id: ctx.sessionID,
        time_created: Date.now(),
        data,
      })
      .run()
  })
}

function relay() {
  const requests: RemoteProtocol.BrowserRequest[] = []
  const queued: RemoteProtocol.BrowserRequest[] = []
  let resolve: ((request: RemoteProtocol.BrowserRequest) => void) | undefined
  const client = BrowserClient.create(() => ({
    connected: true,
    heartbeat: async () => {},
    send(message) {
      if (message.type !== "browser_request") return false
      requests.push(message)
      if (resolve) {
        const next = resolve
        resolve = undefined
        next(message)
      } else queued.push(message)
      return true
    },
  }))
  client.handle({ type: "heartbeat_ack", capabilities: { browserJobsV1: true } })
  spyOn(KiloSessions, "browser").mockReturnValue(client)
  return {
    client,
    requests,
    next: () =>
      queued.length
        ? Promise.resolve(queued.shift()!)
        : new Promise<RemoteProtocol.BrowserRequest>((next) => {
            resolve = next
          }),
    reply: (request: RemoteProtocol.BrowserRequest, response: RemoteProtocol.BrowserResponse["response"]) =>
      client.handle(
        RemoteProtocol.BrowserResponse.parse({ type: "browser_response", requestId: request.requestId, response }),
      ),
  }
}

const tool = Effect.gen(function* () {
  return yield* Tool.init(yield* BrowserTaskTool)
})
const folder = (ctx: Tool.Context) => path.join(Global.Path.data, "browser-owner", ctx.sessionID)

describe("browser_task permission and schema", () => {
  it.live("returns actionable remote enablement without creating ownership or enabling sessions", () =>
    Effect.gen(function* () {
      const ctx = context()
      const current = yield* tool
      const before = KiloSessions.remoteStatus()
      const result = yield* current.execute(args, ctx)
      expect(JSON.parse(result.output)).toMatchObject({
        status: "rejected",
        reason: "remote_disabled",
        retryable: true,
      })
      expect(result.output).toContain("kilo auth login")
      expect(result.output).toContain("/remote")
      expect(KiloSessions.remoteStatus()).toEqual(before)
      expect(yield* Effect.promise(() => fs.stat(folder(ctx)).catch((err: NodeJS.ErrnoException) => err.code))).toBe(
        "ENOENT",
      )
    }),
  )

  const invalid: unknown[] = [
    { operation: "run", goal: "Missing provider" },
    { operation: "run", goal: "Continuation without provider", browser_task_id: task },
    { operation: "run", provider_id: provider },
    { operation: "run", provider_id: provider, goal: "é".repeat(8193) },
    { operation: "status" },
    { operation: "cancel" },
    { operation: "list", provider_id: provider },
    { operation: "recover", browser_task_id: task },
    ...[
      "user",
      "owner",
      "parentSessionId",
      "processId",
      "capability",
      "parentProof",
      "invocationId",
      "connectionId",
      "PRIVATE_SECRET",
    ].map((key) => ({ ...args, [key]: "PRIVATE_SECRET" })),
  ]
  for (const [index, input] of invalid.entries()) {
    it.live(`rejects operation or identity violation ${index} before any request`, () =>
      Effect.gen(function* () {
        const wire = relay()
        const ctx = context()
        const current: Tool.Def = yield* tool
        const result = yield* current.execute(input, ctx).pipe(Effect.exit)
        expect(Exit.isFailure(result)).toBe(true)
        if (Exit.isFailure(result)) {
          expect(Cause.pretty(result.cause)).toContain("invalid arguments")
          expect(Cause.pretty(result.cause)).not.toContain("PRIVATE_SECRET")
        }
        expect(wire.requests).toEqual([])
        expect(yield* Effect.promise(() => fs.stat(folder(ctx)).catch((err: NodeJS.ErrnoException) => err.code))).toBe(
          "ENOENT",
        )
      }),
    )
  }

  it.live("honors provider and goal permission denial before deriving ownership", () =>
    Effect.gen(function* () {
      const wire = relay()
      const ctx = context()
      ctx.ask = (request) =>
        Effect.sync(() => {
          expect(request.permission).toBe("browser_task")
          expect(request.patterns).toEqual([provider])
          expect(request.metadata).toMatchObject({ provider_id: provider, goal: args.goal })
          throw new Error("Consent denied")
        })
      const current = yield* tool
      const result = yield* current.execute(args, ctx).pipe(Effect.exit)
      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result)) expect(Cause.pretty(result.cause)).toContain("Consent denied")
      expect(wire.requests).toEqual([])
      expect(yield* Effect.promise(() => fs.stat(folder(ctx)).catch((err: NodeJS.ErrnoException) => err.code))).toBe(
        "ENOENT",
      )
    }),
  )

  it.live("fails closed at the sandbox boundary before permission or browser dispatch", () =>
    Effect.gen(function* () {
      const wire = relay()
      const ctx = context()
      ctx.ask = () => Effect.die(new Error("Permission must not run"))
      const current = yield* tool
      const result = yield* sandbox(denied, current.execute(args, ctx)).pipe(Effect.exit)
      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result)) {
        expect(Cause.pretty(result.cause)).toContain("Sandbox denied outbound network access")
        expect(Cause.pretty(result.cause)).not.toContain("Permission must not run")
      }
      expect(wire.requests).toEqual([])
      expect(yield* Effect.promise(() => fs.stat(folder(ctx)).catch((err: NodeJS.ErrnoException) => err.code))).toBe(
        "ENOENT",
      )
    }),
  )

  for (const operation of ["status", "cancel", "run"] as const) {
    it.live(`denies a foreign conversation during ${operation} without network authority`, () =>
      Effect.gen(function* () {
        const wire = relay()
        const foreign = context()
        yield* seed(foreign)
        const owner = yield* BrowserOwner.open(foreign)
        yield* Effect.promise(async () => {
          await owner.approve(provider)
          await owner.prepare({ providerId: provider, goal: "A different parent's browser goal" })
          await owner.remember({
            providerId: provider,
            browserTaskId: task,
            jobId: `bj_${crypto.randomUUID()}`,
            invocationId: owner.invocationId,
          })
        })
        const ctx = context()
        yield* seed(ctx)
        const current = yield* tool
        const input: RemoteProtocol.BrowserTaskArguments =
          operation === "run" ? { ...args, browser_task_id: task } : { operation, browser_task_id: task }
        const result = yield* current.execute(input, ctx)
        expect(JSON.parse(result.output)).toMatchObject({ status: "rejected", reason: "not_found", retryable: false })
        expect(wire.requests).toEqual([])
      }),
    )
  }

  it.live("discovery stays read-only and does not create a default provider or owner", () =>
    Effect.gen(function* () {
      const wire = relay()
      const ctx = context()
      const current = yield* tool
      const pending = yield* current.execute({ operation: "list" }, ctx).pipe(Effect.forkChild)
      const request = yield* Effect.promise(wire.next)
      expect(request.operation).toBe("list")
      wire.reply(request, {
        kind: "providers",
        providers: [{ providerId: provider, label: "Work profile", availability: "available", queueDepth: 0 }],
      })
      const result = yield* Fiber.join(pending)
      expect(JSON.parse(result.output).providers).toEqual([
        { providerId: provider, label: "Work profile", availability: "available", queueDepth: 0 },
      ])
      expect(wire.requests).toHaveLength(1)
      expect(yield* Effect.promise(() => fs.stat(folder(ctx)).catch((err: NodeJS.ErrnoException) => err.code))).toBe(
        "ENOENT",
      )
    }),
  )
})

it.live("formats accepted handle persistence failure as interrupted delivery with lookup-only recovery", () =>
  Effect.gen(function* () {
    const wire = relay()
    const ctx = context()
    yield* seed(ctx)
    const current = yield* tool
    const pending = yield* current.execute(args, ctx).pipe(Effect.forkChild)
    const request = yield* Effect.promise(wire.next)
    if (request.operation !== "invoke") throw new Error("Expected run dispatch")
    const handle: RemoteProtocol.BrowserJobHandle = {
      providerId: provider,
      browserTaskId: task,
      jobId: `bj_${crypto.randomUUID()}`,
      invocationId: request.invocationId,
    }
    const dir = folder(ctx)
    yield* Effect.acquireUseRelease(
      Effect.promise(() => fs.rename(dir, `${dir}.unavailable`)),
      () =>
        Effect.gen(function* () {
          wire.reply(request, { kind: "ack", operation: "invoke", ...handle })
          const result = yield* Fiber.join(pending)
          expect(result.title).toBe("Browser task: interrupted")
          expect(JSON.parse(result.output)).toMatchObject({
            status: "interrupted",
            reason: "delivery_interrupted",
            provider_id: provider,
            browser_task_id: task,
            job_id: handle.jobId,
            invocation_id: handle.invocationId,
            evidence: [],
            effectsUncertain: true,
            retryable: true,
          })
          expect(result.metadata).toMatchObject(JSON.parse(result.output))
          expect(result.output).toContain("accepted")
          expect(result.output).toContain("persistence failed")
          expect(result.output).toContain("does not establish browser failure")
          expect(result.output).toContain("Once private browser storage is available")
          expect(result.output).toContain("operation=recover")
          expect(result.output).toContain("without replay")
          expect(result.output).toContain("Do not automatically repeat operation=run")
          expect(result.output).not.toContain(request.owner.parentProof)
          expect(wire.requests.map((request) => request.operation)).toEqual(["invoke"])
        }),
      () => Effect.promise(() => fs.rename(`${dir}.unavailable`, dir)),
    )
    const owner = yield* BrowserOwner.open(ctx)
    expect((yield* Effect.promise(() => owner.recover())).at(0)?.handle).toBeUndefined()
  }),
)

it.live("explains a busy continuation and checks its outstanding job only on an explicit status call", () =>
  Effect.gen(function* () {
    const wire = relay()
    const ctx = context()
    yield* seed(ctx)
    const owner = yield* BrowserOwner.open(ctx)
    const handle: RemoteProtocol.BrowserJobHandle = {
      providerId: provider,
      browserTaskId: task,
      jobId: `bj_${crypto.randomUUID()}`,
      invocationId: owner.invocationId,
    }
    yield* Effect.promise(async () => {
      await owner.approve(provider)
      await owner.prepare({ providerId: provider, goal: args.goal })
      await owner.remember(handle)
    })
    const current = yield* tool
    const pending = yield* current
      .execute({ ...args, browser_task_id: task, goal: "Read the next page" }, { ...ctx, callID: "continue" })
      .pipe(Effect.forkChild)
    const request = yield* Effect.promise(wire.next)
    expect(request).toMatchObject({ operation: "invoke", browserTaskId: task, goal: "Read the next page" })
    wire.reply(request, { kind: "error", code: "conversation_busy", retryable: true, message: "Conversation busy" })
    const result = yield* Fiber.join(pending)
    expect(JSON.parse(result.output)).toMatchObject({
      status: "rejected",
      reason: "conversation_busy",
      retryable: true,
      effectsUncertain: false,
    })
    expect(result.output).toContain("outstanding job")
    expect(result.output).toContain("operation=status")
    expect(result.output).toContain("same browser_task_id")
    expect(result.output).toContain("operation=cancel")
    expect(result.output).toContain("Do not automatically retry the continuation")
    expect(wire.requests.map((request) => request.operation)).toEqual(["invoke"])
    const polling = yield* current
      .execute({ operation: "status", browser_task_id: task }, { ...ctx, callID: "check-outstanding-job" })
      .pipe(Effect.forkChild)
    const status = yield* Effect.promise(wire.next)
    expect(status).toMatchObject({ operation: "status", browserTaskId: task })
    const created = Number(handle.invocationId.split(".").at(1))
    wire.reply(status, {
      kind: "status",
      job: {
        ...handle,
        status: "queued",
        generation: 1,
        payloadFingerprint: "a".repeat(64),
        createdAt: new Date(created).toISOString(),
        expiresAt: new Date(created + 604_800_000).toISOString(),
        deadlines: { queue: new Date(created + 600_000).toISOString() },
      },
    })
    expect(JSON.parse((yield* Fiber.join(polling)).output)).toMatchObject({
      status: "queued",
      browser_task_id: task,
      job_id: handle.jobId,
      invocation_id: owner.invocationId,
    })
    expect(wire.requests.map((request) => request.operation)).toEqual(["invoke", "status"])
  }),
)

it.live("requires panel recovery and fresh consent after an uncertain execution rejection", () =>
  Effect.gen(function* () {
    const wire = relay()
    const ctx = context()
    yield* seed(ctx)
    const current = yield* tool
    const pending = yield* current.execute(args, ctx).pipe(Effect.forkChild)
    const request = yield* Effect.promise(wire.next)
    wire.reply(request, {
      kind: "error",
      code: "effects_uncertain",
      retryable: false,
      message: "Prior effects are uncertain",
    })
    const result = yield* Fiber.join(pending)
    expect(JSON.parse(result.output)).toMatchObject({
      status: "rejected",
      reason: "effects_uncertain",
      effectsUncertain: true,
      retryable: false,
    })
    expect(result.output).toContain("Close the affected bound tabs")
    expect(result.output).toContain("release execution locks")
    expect(result.output).toContain("panel recovery action")
    expect(result.output).toContain("approve a fresh tab")
    expect(wire.requests.map((request) => request.operation)).toEqual(["invoke"])
  }),
)

for (const status of ["succeeded", "failed", "interrupted", "timed_out", "cancelled"] as const) {
  it.live(`formats an honest ${status} outcome and empty evidence for only its owning chat`, () =>
    Effect.gen(function* () {
      const wire = relay()
      const ctx = context()
      yield* seed(ctx)
      const updates: unknown[] = []
      ctx.metadata = (value) =>
        Effect.sync(() => {
          updates.push(value)
        })
      const current = yield* tool
      const pending = yield* current.execute(args, ctx).pipe(Effect.forkChild)
      const request = yield* Effect.promise(wire.next)
      if (request.operation !== "invoke") throw new Error("Expected run dispatch")
      const owner = yield* BrowserOwner.open(ctx)
      const intent = (yield* Effect.promise(() => owner.recover())).at(0)!
      const handle: RemoteProtocol.BrowserJobHandle = {
        providerId: provider,
        browserTaskId: task,
        jobId: `bj_${crypto.randomUUID()}`,
        invocationId: request.invocationId,
      }
      wire.reply(request, { kind: "ack", operation: "invoke", ...handle })
      const poll = yield* Effect.promise(wire.next)
      expect(poll.operation).toBe("status")
      expect(updates.at(0)).toMatchObject({
        metadata: { status: "accepted", job_id: handle.jobId, browser_task_id: task },
      })
      const result = RemoteProtocol.BrowserResult.parse({
        ...handle,
        status,
        reason: status === "succeeded" ? "completed" : status === "cancelled" ? "cancelled" : "runner_failed",
        effectsUncertain: status === "interrupted",
        summary: `Observed ${status} outcome`,
        evidence: [],
      })
      const created = Number(request.invocationId.split(".").at(1))
      const hash = (fields: string[]) => createHash("sha256").update(JSON.stringify(fields)).digest("hex")
      const job = RemoteProtocol.BrowserJobSnapshot.parse({
        ...handle,
        generation: 1,
        payloadFingerprint: hash([
          "user_1",
          request.owner.parentSessionId,
          hash([request.owner.parentProof]),
          request.providerId,
          request.browserTaskId ?? "",
          request.goal,
        ]),
        createdAt: new Date(created).toISOString(),
        expiresAt: new Date(created + 604_800_000).toISOString(),
        deadlines: { queue: new Date(created + 600_000).toISOString() },
        status,
        result,
      })
      expect(job.payloadFingerprint).not.toBe(intent.payloadFingerprint)
      wire.reply(poll, { kind: "status", job })
      const finished = yield* Fiber.join(pending)
      expect(JSON.parse(finished.output)).toMatchObject({
        status,
        reason: result.reason,
        summary: result.summary,
        evidence: [],
        effectsUncertain: result.effectsUncertain,
        browser_task_id: task,
        job_id: handle.jobId,
      })
      if (status === "interrupted") {
        expect(finished.output).toContain("Close the affected bound tabs")
        expect(finished.output).toContain("approve a fresh tab")
      }
      const foreign = context()
      yield* seed(foreign)
      const outsider = yield* BrowserOwner.open(foreign)
      expect(yield* Effect.promise(() => outsider.approved(provider))).toBe(false)
      expect(yield* Effect.promise(() => owner.approved(provider))).toBe(true)
    }),
  )
}

const registry = testEffect(
  LayerNode.compile(ToolRegistry.node, [
    [Config.node, TestConfig.layer({ directories: () => Effect.succeed([]) })],
    [RuntimeFlags.node, RuntimeFlags.layer({})],
  ]),
)
registry.instance("exposes browser_task through the real registry with its sandbox annotation", () =>
  Effect.gen(function* () {
    const service = yield* ToolRegistry.Service
    const tools = yield* service.all()
    const browser = tools.find((tool) => tool.id === "browser_task")
    if (!browser) throw new Error("The browser tool is absent from the registry")
    expect(Network.isBuiltin(browser)).toBe(true)
    const boundary = yield* sandbox(denied, Network.tool(browser, Effect.succeed("dispatch"))).pipe(Effect.exit)
    expect(Exit.isFailure(boundary)).toBe(true)
    if (Exit.isFailure(boundary))
      expect(Cause.pretty(boundary.cause)).toContain("Sandbox denied outbound network access")
    const result = yield* browser.execute({ operation: "list" }, context())
    expect(JSON.parse(result.output).reason).toBe("remote_disabled")
  }),
)
