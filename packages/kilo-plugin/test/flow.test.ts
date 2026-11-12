import { expect, test } from "bun:test"
import { Agent } from "@opencode/core/agent"
import { Model } from "@opencode/core/model"
import { Permission } from "@opencode/core/permission"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { Provider } from "@opencode/core/provider"
import { Schedule } from "@opencode/core/schedule"
import { Tool } from "@opencode/core/tool"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { AbsolutePath } from "@opencode/schema/schema"
import { assemble, create, flowPermissions, list, permissionInstructions, scheduled, storedRecord } from "../src/flow"
import { KiloFlowPlugin } from "../src/flow"
import { validatePermissions } from "../src/flow/permissions"
import { KiloFlowRpc } from "@opencode/schema/kilocode/flow"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { FSUtil } from "@opencode/util/fs-util"
import { DateTime, Deferred, Effect, Fiber, Layer, Schema, Semaphore } from "effect"
import { testEffect } from "../../core/test/lib/effect"
import { makePluginTestLayer, PluginTestLayer } from "../../core/test/plugin/fixture"

const backingSchedules = new Map<Schedule.ID, Schedule.Info>()
let scheduleCounter = 0

const scheduleMock = Layer.mock(Schedule.Service, {
  list: () => Effect.succeed([...backingSchedules.values()]),
  get: (scheduleID) => {
    const found = backingSchedules.get(scheduleID)
    return found ? Effect.succeed(found) : Effect.fail(new Schedule.NotFoundError({ scheduleID }))
  },
  create: (input) =>
    Effect.sync(() => {
      const now = Date.now()
      const schedule = Schema.decodeUnknownSync(Schedule.Info)({
        id: `sch_flow_${++scheduleCounter}`,
        sessionID: input.sessionID,
        name: input.name,
        when: input.when,
        tz: input.when?.tz ?? "UTC",
        action: input.action,
        status: "active",
        nextDueAt: now + 60_000,
        ...(input.ends?.times === undefined ? {} : { remainingRuns: input.ends.times }),
        runCount: 0,
        time: { created: now, updated: now },
      })
      backingSchedules.set(schedule.id, schedule)
      return schedule
    }),
  pause: (scheduleID) => {
    const found = backingSchedules.get(scheduleID)
    if (!found) return Effect.fail(new Schedule.NotFoundError({ scheduleID }))
    const paused: Schedule.Info = { ...found, status: "paused" }
    backingSchedules.set(scheduleID, paused)
    return Effect.succeed(paused)
  },
  remove: (scheduleID) => Effect.sync(() => backingSchedules.delete(scheduleID)).pipe(Effect.asVoid),
})

const it = testEffect(Layer.merge(PluginTestLayer, scheduleMock))

const approvals: Parameters<Permission.Interface["assert"]>[0][] = []
const recording = testEffect(
  Layer.merge(
    makePluginTestLayer(
      Layer.succeed(
        Permission.Service,
        Permission.Service.of({
          close: Effect.void,
          ask: (input) => Effect.succeed({ id: input.id ?? Permission.ID.create(), effect: "ask" }),
          assert: (input) => Effect.sync(() => void approvals.push(input)),
          assertNotDenied: () => Effect.void,
          allows: () => Effect.succeed(false),
          reply: () => Effect.void,
          get: () => Effect.succeed(undefined),
          forSession: () => Effect.succeed([]),
          list: () => Effect.succeed([]),
        }),
      ),
    ),
    scheduleMock,
  ),
)

const session = Schema.decodeUnknownSync(Session.Info)({
  id: "ses_flow_test",
  projectID: "proj_flow_test",
  agent: "build",
  model: { providerID: "kilo", id: "free" },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 1 },
  location: { directory: "/workspace" },
})

const schedule = (input: {
  id: string
  sessionID?: string
  status?: "active" | "paused" | "done"
  poll?: "if" | "until"
  next?: number
}) =>
  Schema.decodeUnknownSync(Schedule.Info)({
    id: input.id,
    sessionID: input.sessionID,
    name: input.id,
    when: { type: "every", every: "5 minutes" },
    tz: "America/Detroit",
    ...(input.poll === "if" ? { if: { type: "shell", run: "test -f ready" } } : {}),
    ...(input.poll === "until" ? { until: { type: "code", code: "return true" } } : {}),
    action: { type: "prompt", prompt: `Run ${input.id}` },
    status: input.status ?? "active",
    ...(input.next === undefined ? {} : { nextDueAt: input.next }),
    runCount: 0,
    time: { created: 10, updated: 20 },
  })

const record = (id: string, scheduleID?: Schedule.ID) =>
  Schema.decodeUnknownSync(KiloFlowRpc.Record)({
    version: 1,
    id,
    name: "Managed cleanup",
    authority: { type: "local" },
    trigger: {
      type: "time",
      when: { type: "cron", cron: "0 9 * * 1" },
      timezone: "America/Detroit",
    },
    execution: {
      type: "local",
      mode: "fresh",
      sourceSessionID: "ses_source",
      templateSessionID: "ses_template",
      worktree: "new",
    },
    context: {
      directory: "/workspace",
      projectID: "proj_flow_test",
      sessionID: "ses_source",
      model: { providerID: "kilo", id: "free" },
      agent: "build",
    },
    prompt: "Clean up",
    permissions: [],
    ...(scheduleID ? { scheduleID } : {}),
    time: { created: 1, updated: 2 },
  })

test("aggregates time and polling schedules with Session metadata and status mapping", () => {
  const time = schedule({ id: "sch_time", sessionID: session.id, next: 200 })
  const poll = schedule({ id: "sch_poll", sessionID: session.id, poll: "until", status: "done" })
  const output = assemble({
    records: [],
    schedules: [time, poll],
    sessions: new Map([
      [time.id, session],
      [poll.id, session],
    ]),
    warnings: [],
    observedAt: 100,
  })

  expect(output.flows[0]).toMatchObject({
    reference: { type: "native-schedule", scheduleID: time.id },
    authority: { type: "local" },
    trigger: { type: "time" },
    execution: { type: "local", mode: "session-reuse", sessionID: session.id },
    context: {
      directory: "/workspace",
      projectID: "proj_flow_test",
      model: { providerID: "kilo", id: "free" },
      agent: "build",
    },
    status: "active",
    nextRunAt: 200,
  })
  expect(output.flows[1]).toMatchObject({ trigger: { type: "poll", mode: "until" }, status: "completed" })
})

test("managed records suppress native duplicates and stale backing schedules remain visible as errors", () => {
  const backing = schedule({ id: "sch_managed", sessionID: session.id })
  const stale = record("flw_stale", Schedule.ID.make("sch_missing"))
  const managed = record("flw_managed", backing.id)
  const output = assemble({
    records: [managed, stale],
    schedules: [backing],
    sessions: new Map([[backing.id, session]]),
    warnings: [],
    observedAt: 100,
  })

  expect(output.flows).toHaveLength(2)
  expect(output.flows[0]).toMatchObject({
    reference: { type: "managed", flowID: managed.id, scheduleID: backing.id },
    execution: { mode: "fresh" },
    health: { status: "healthy" },
  })
  expect(output.flows[1]).toMatchObject({
    reference: { type: "managed", flowID: stale.id },
    status: "error",
    health: { status: "error" },
  })
})

test("managed definitions without a scheduler remain visible as paused and executable", () => {
  const configured = record("flw_configured")
  const output = assemble({
    records: [configured],
    schedules: [],
    sessions: new Map(),
    warnings: [],
    observedAt: 100,
  })

  expect(output.flows).toEqual([
    expect.objectContaining({
      reference: { type: "managed", flowID: configured.id },
      status: "paused",
      health: { status: "healthy" },
    }),
  ])
})

test("a skipped occurrence does not hide the latest executable run", () => {
  const managed = record("flw_latest", Schedule.ID.make("sch_latest"))
  const backing = schedule({ id: "sch_latest", sessionID: session.id })
  const running = Schema.decodeUnknownSync(KiloFlowRpc.Run)({
    version: 1,
    id: "flr_running",
    flowID: managed.id,
    status: "running",
    worktree: "reuse",
    sessionID: "ses_running",
    directory: "/workspace",
    time: { created: 10, updated: 10, started: 10 },
  })
  const skipped = Schema.decodeUnknownSync(KiloFlowRpc.Run)({
    version: 1,
    id: "flr_skipped",
    flowID: managed.id,
    status: "skipped",
    worktree: "reuse",
    time: { created: 20, updated: 20, completed: 20 },
  })
  const output = assemble({
    records: [managed],
    runs: [running, skipped],
    schedules: [backing],
    sessions: new Map([[backing.id, session]]),
    warnings: [],
    observedAt: 100,
  })

  expect(output.flows[0]?.latestRun).toEqual(running)
})

test("describes the exact unattended permission contract to a Flow executor", () => {
  expect(
    permissionInstructions(
      [
        { action: "shell", resource: "taskctl *" },
        { action: "edit", resource: "/home/user/status.txt" },
        { action: "external_directory", resource: "/home/user/*" },
      ],
      ["write", "shell", "read"],
    ),
  ).toBe(
    [
      "You are running an unattended Flow. No user is present to approve additional permissions.",
      "Available tools for this run:",
      "- read",
      "- shell",
      "- write",
      "Approved permission patterns:",
      "- shell: taskctl *",
      "- edit: /home/user/status.txt",
      "- external_directory: /home/user/*",
      "Everything not matched by an approved action and resource pattern is denied.",
      "How permission resources are matched:",
      "- read and edit match Location-relative file paths; write, patch, and opencode use the edit action.",
      "- glob and grep match their pattern text, not the directory searched.",
      "- shell matches every parsed command in a compound command separately.",
      "- webfetch matches the requested URL and every redirect URL; websearch matches the query text.",
      "- Paths outside the Location also require an external_directory rule for the containing directory wildcard.",
      "- MCP tool actions use the exposed tool name and currently request resource `*`.",
      "Choose tool inputs that match these patterns exactly. Prefer dedicated read, edit, or write tools over shell redirection when their actions are approved.",
      "Do not make exploratory or preflight tool calls outside the allowlist, and do not work around or retry a denied operation. If the allowlist cannot complete the task, report the missing action and resource.",
    ].join("\n"),
  )
})

test("preserves requested permission resources and removes exact duplicates", () => {
  expect(
    flowPermissions([
      { action: "shell", resource: "taskctl *" },
      { action: "edit", resource: "reports/*" },
      { action: "edit", resource: "reports/*" },
      { action: "webfetch", resource: "https://api.example.com/*" },
      { action: "github_create_issue", resource: "*" },
      { action: "external_directory", resource: "/home/user/*" },
    ]),
  ).toEqual([
    { action: "read", resource: "*" },
    { action: "glob", resource: "*" },
    { action: "grep", resource: "*" },
    { action: "shell", resource: "taskctl *" },
    { action: "edit", resource: "reports/*" },
    { action: "webfetch", resource: "https://api.example.com/*" },
    { action: "github_create_issue", resource: "*" },
    { action: "external_directory", resource: "/home/user/*" },
  ])
})

test("scoped Flow permissions allow matching resources and deny everything else", () => {
  const rules = [
    { action: "*", resource: "*", effect: "deny" as const },
    ...flowPermissions([
      { action: "shell", resource: "taskctl *" },
      { action: "edit", resource: "reports/*" },
    ]).map((permission) => ({ ...permission, effect: "allow" as const })),
  ]
  expect(Permission.evaluate("shell", "taskctl inspect --short", rules).effect).toBe("allow")
  expect(Permission.evaluate("shell", "otherctl inspect", rules).effect).toBe("deny")
  expect(Permission.evaluate("edit", "reports/daily.md", rules).effect).toBe("allow")
  expect(Permission.evaluate("edit", "src/index.ts", rules).effect).toBe("deny")
})

test.each(["/home/user/*", "C:\\Users\\me\\*", "\\\\server\\share\\*"])(
  "accepts bounded external directory permission %s",
  (resource) => {
    expect(validatePermissions([{ action: "external_directory", resource }])).toBeUndefined()
  },
)

test.each(["/home/user/*", "C:\\Users\\me\\*", "\\\\server\\share\\*"])(
  "rejects absolute directory wildcard %s as a shell resource",
  (resource) => {
    const error = validatePermissions([{ action: "shell", resource }])
    expect(error).toContain(`shell permission ${resource} is an absolute directory wildcard`)
    expect(error).toContain(`use external_directory: ${resource}`)
    expect(error).toContain("add separate shell permissions for the required commands")
  },
)

test("accepts an absolute executable command pattern as a shell resource", () => {
  expect(validatePermissions([{ action: "shell", resource: "/usr/bin/taskctl *" }])).toBeUndefined()
})

test.each(["*", "/*", "home/user/*", "../home/user/*", "/home/user/../*"])(
  "rejects unbounded external directory permission %s",
  (resource) => {
    expect(validatePermissions([{ action: "external_directory", resource }])).toContain(
      "must use a bounded absolute wildcard below a directory",
    )
  },
)

test("missing Sessions and malformed stored records are isolated", () => {
  const missing = schedule({ id: "sch_orphan", sessionID: "ses_missing" })
  const output = assemble({ records: [], schedules: [missing], sessions: new Map(), warnings: [], observedAt: 100 })
  expect(output.flows[0]).toMatchObject({ status: "error", health: { status: "error" } })

  expect(storedRecord("flow:v1:flw_bad", "not json")).toEqual({
    warning: {
      source: "managed",
      reference: "flow:v1:flw_bad",
      message: "Stored Flow record is malformed or stale",
    },
  })
  const valid = record("flw_valid", Schedule.ID.make("sch_valid"))
  expect(storedRecord(`flow:v1:${valid.id}`, JSON.stringify(valid))).toEqual({ record: valid })
  const legacy = Schema.decodeUnknownSync(KiloFlowRpc.Record)({
    ...valid,
    id: "flw_legacy",
    permissions: [{ action: "shell", resource: "*" }],
  })
  expect(storedRecord(`flow:v1:${legacy.id}`, JSON.stringify(legacy))).toEqual({ record: legacy })
})

it.live("drops the lock of a create that fails before its Flow exists", () =>
  Effect.gen(function* () {
    backingSchedules.clear()
    const plugins = yield* Plugin.Service
    const context = yield* PluginHost.make(plugins, "test")
    const schedules = yield* Schedule.Service
    const source = yield* context.session.create({
      title: "Flow source",
      agent: Agent.ID.make("build"),
      model: { providerID: Provider.ID.make("kilo"), id: Model.ID.make("free") },
    })
    const locks = new Map<KiloFlowRpc.ID, Semaphore.Semaphore>()
    const runtime = { locks, changed: () => Effect.void }
    const input = {
      sourceSessionID: source.id,
      name: "Lock check",
      when: { every: "1 day" as const, tz: "UTC" },
      prompt: "Check once",
      worktree: "reuse" as const,
      permissions: [],
      requestID: "00112233445566778899aabbccddeeff",
    }
    const failing = { ...schedules, create: () => Effect.fail(new Schedule.InvalidError({ reason: "scheduler unavailable" })) }
    const failure = yield* create(context, failing, input, source.projectID, runtime).pipe(Effect.flip)
    expect(failure.message).toContain("scheduler unavailable")
    expect(locks.size).toBe(0)
    // A create that persists keeps its lock for the runs and edits that follow.
    yield* create(context, schedules, input, source.projectID, runtime)
    expect([...locks.keys()]).toEqual([KiloFlowRpc.ID.make(`flw_${input.requestID}`)])

    // A failing create must not drop the lock another create with the same id is already queued on.
    const raced = { ...input, requestID: "ffeeddccbbaa99887766554433221100" }
    const entered = yield* Deferred.make<void>()
    const gate = yield* Deferred.make<void>()
    const blocked = {
      ...schedules,
      create: () =>
        Deferred.succeed(entered, undefined).pipe(
          Effect.andThen(Deferred.await(gate)),
          Effect.andThen(Effect.fail(new Schedule.InvalidError({ reason: "scheduler unavailable" }))),
        ),
    }
    const first = yield* create(context, blocked, raced, source.projectID, runtime).pipe(Effect.flip, Effect.forkChild)
    yield* Deferred.await(entered)
    const lock = locks.get(KiloFlowRpc.ID.make(`flw_${raced.requestID}`))
    const second = yield* create(context, schedules, raced, source.projectID, runtime).pipe(Effect.forkChild)
    yield* Effect.yieldNow
    yield* Deferred.succeed(gate, undefined)
    expect((yield* Fiber.join(first)).message).toContain("scheduler unavailable")
    yield* Fiber.join(second)
    expect(locks.get(KiloFlowRpc.ID.make(`flw_${raced.requestID}`))).toBe(lock)
  }),
)

it.live("returns the existing Flow when a create is retried with the same request id", () =>
  Effect.gen(function* () {
    backingSchedules.clear()
    scheduleCounter = 0
    const plugins = yield* Plugin.Service
    const context = yield* PluginHost.make(plugins, "test")
    yield* KiloFlowPlugin.effect(context)
    const tools = yield* Tool.Service
    const flowCreate = (yield* tools.list()).find((tool) => tool.id === "flow_create")
    if (!flowCreate) return yield* Effect.die("Expected flow_create to be registered")
    const source = yield* context.session.create({
      title: "Flow source",
      agent: Agent.ID.make("build"),
      model: { providerID: Provider.ID.make("kilo"), id: Model.ID.make("free") },
    })
    const requestID = "0123456789abcdef0123456789abcdef"
    const input = {
      name: "Idempotent check",
      when: { every: "1 day" as const, tz: "UTC" },
      prompt: "Check the project once",
      worktree: "reuse" as const,
      permissions: [],
      requestID,
    }
    const call = (id: string) => ({
      sessionID: source.id,
      agent: Agent.ID.make("build"),
      messageID: SessionMessage.ID.create(),
      id: Tool.CallID.make(id),
      progress: () => Effect.void,
    })
    const first = yield* flowCreate.execute(input, call("call_idempotent_first"))
    const second = yield* flowCreate.execute(input, call("call_idempotent_second"))
    if (!first.output || first.output.reference.type !== "managed")
      return yield* Effect.die("Expected the first create to return a managed Flow")
    if (!second.output || second.output.reference.type !== "managed")
      return yield* Effect.die("Expected the retry to return a managed Flow")
    expect(second.output.reference.flowID).toBe(first.output.reference.flowID)
    expect(second.output.reference.flowID).toBe(`flw_${requestID}`)
    expect(second.output.reference.scheduleID).toBe(first.output.reference.scheduleID)
    expect((yield* (yield* Schedule.Service).list()).length).toBe(1)
    expect(backingSchedules.size).toBe(1)
    // Reusing the key with other settings is a conflict that names the Flow, never a silent return or a duplicate.
    const stored = yield* context.storage.get(`flow:v1:flw_${requestID}`)
    const conflict = yield* flowCreate
      .execute({ ...input, permissions: [{ action: "shell", resource: "npm test" }] }, call("call_idempotent_edited"))
      .pipe(Effect.flip)
    expect(conflict.message).toContain(`Flow flw_${requestID} was already created from this request with different settings`)
    expect(yield* context.storage.get(`flow:v1:flw_${requestID}`)).toBe(stored)
    expect(backingSchedules.size).toBe(1)
  }),
)

it.live("registers and executes the managed Flow creation and run tools", () =>
  Effect.gen(function* () {
    backingSchedules.clear()
    scheduleCounter = 0
    const plugins = yield* Plugin.Service
    const context = yield* PluginHost.make(plugins, "test")
    const schedules = yield* Schedule.Service
    const fs = yield* FSUtil.Service
    const abandoned = record("flw_abandoned")
    const abandonedRun = Schema.decodeUnknownSync(KiloFlowRpc.Run)({
      version: 1,
      id: "flr_abandoned",
      flowID: abandoned.id,
      status: "starting",
      worktree: "reuse",
      time: { created: 1, updated: 1 },
    })
    yield* context.storage.set(`flow:v1:${abandoned.id}`, JSON.stringify(abandoned))
    yield* context.storage.set(`flow-run:v1:${abandoned.id}:${abandonedRun.id}`, JSON.stringify(abandonedRun))
    yield* context.storage.set(`flow-active:v1:${abandoned.id}`, abandonedRun.id)
    yield* KiloFlowPlugin.effect(context)
    expect(yield* context.storage.get(`flow-run:v1:${abandoned.id}:${abandonedRun.id}`)).toContain('"status":"failed"')
    expect(yield* context.storage.get(`flow-active:v1:${abandoned.id}`)).toBeUndefined()
    yield* context.storage.remove(`flow:v1:${abandoned.id}`)
    yield* context.storage.remove(`flow-run:v1:${abandoned.id}:${abandonedRun.id}`)
    const tools = yield* Tool.Service
    const flowCreate = (yield* tools.list()).find((tool) => tool.id === "flow_create")
    const flowRun = (yield* tools.list()).find((tool) => tool.id === "flow_run")
    expect(flowCreate).toMatchObject({
      name: "flow_create",
      options: { codemode: true },
    })
    expect(flowRun).toMatchObject({ name: "flow_run", options: { codemode: true } })
    if (!flowCreate || !flowRun) return yield* Effect.die("Expected Flow tools to be registered")
    const source = yield* context.session.create({
      title: "Flow source",
      agent: Agent.ID.make("build"),
      model: { providerID: Provider.ID.make("kilo"), id: Model.ID.make("free") },
    })
    const invalid = yield* flowCreate
      .execute(
        {
          name: "Invalid external permission",
          when: { every: "1 day", tz: "UTC" },
          prompt: "Write outside the project",
          worktree: "reuse",
          permissions: [{ action: "external_directory", resource: "*" }],
        },
        {
          sessionID: source.id,
          agent: Agent.ID.make("build"),
          messageID: SessionMessage.ID.create(),
          id: Tool.CallID.make("call_invalid_flow_create"),
          progress: () => Effect.void,
        },
      )
      .pipe(Effect.flip)
    expect(invalid.message).toContain("must use a bounded absolute wildcard")
    const wildcardAction = yield* flowCreate
      .execute(
        {
          name: "Invalid wildcard action",
          when: { every: "1 day", tz: "UTC" },
          prompt: "Use arbitrary tools",
          worktree: "reuse",
          permissions: [{ action: "*", resource: "*" }],
        },
        {
          sessionID: source.id,
          agent: Agent.ID.make("build"),
          messageID: SessionMessage.ID.create(),
          id: Tool.CallID.make("call_invalid_flow_action"),
          progress: () => Effect.void,
        },
      )
      .pipe(Effect.flip)
    expect(wildcardAction.message).toContain("must name one concrete capability")
    const directoryShell = yield* flowCreate
      .execute(
        {
          name: "Invalid shell directory",
          when: { every: "1 day", tz: "UTC" },
          prompt: "Run a command outside the project",
          worktree: "reuse",
          permissions: [{ action: "shell", resource: "/home/user/*" }],
        },
        {
          sessionID: source.id,
          agent: Agent.ID.make("build"),
          messageID: SessionMessage.ID.create(),
          id: Tool.CallID.make("call_invalid_flow_shell_directory"),
          progress: () => Effect.void,
        },
      )
      .pipe(Effect.flip)
    expect(directoryShell.message).toContain("shell resources must match command text")
    expect(directoryShell.message).toContain("use external_directory: /home/user/*")
    expect(backingSchedules.size).toBe(0)
    const invalidStored = Schema.decodeUnknownSync(KiloFlowRpc.Record)({
      ...record("flw_invalid_stored"),
      execution: {
        type: "local",
        mode: "fresh",
        sourceSessionID: source.id,
        worktree: "reuse",
      },
      context: {
        directory: source.location.directory,
        projectID: source.projectID,
        sessionID: source.id,
        model: source.model,
        agent: source.agent,
      },
      permissions: [{ action: "shell", resource: "/home/user/*" }],
    })
    yield* context.storage.set(`flow:v1:${invalidStored.id}`, JSON.stringify(invalidStored))
    const invalidStoredRun = yield* flowRun
      .execute(
        { flowID: invalidStored.id },
        {
          sessionID: source.id,
          agent: Agent.ID.make("build"),
          messageID: SessionMessage.ID.create(),
          id: Tool.CallID.make("call_invalid_stored_flow_run"),
          progress: () => Effect.void,
        },
      )
      .pipe(Effect.flip)
    expect(invalidStoredRun.message).toContain(`Flow ${invalidStored.id} has invalid permissions`)
    expect(invalidStoredRun.message).toContain("shell resources must match command text")
    yield* context.storage.remove(`flow:v1:${invalidStored.id}`)
    const created = yield* flowCreate.execute(
      {
        name: "Nightly check",
        when: { every: "1 day", tz: "UTC" },
        prompt: "Check the project",
        worktree: "reuse",
        permissions: [
          { action: "shell", resource: "taskctl *" },
          { action: "edit", resource: "reports/*" },
        ],
      },
      {
        sessionID: source.id,
        agent: Agent.ID.make("build"),
        messageID: SessionMessage.ID.create(),
        id: Tool.CallID.make("call_flow_create"),
        progress: () => Effect.void,
      },
    )
    if (!created.output || created.output.reference.type !== "managed")
      return yield* Effect.die("Expected flow_create to return a managed Flow")
    expect(created.output).toMatchObject({
      reference: { type: "managed", scheduleID: expect.any(String) },
      permissions: [
        { action: "read", resource: "*" },
        { action: "glob", resource: "*" },
        { action: "grep", resource: "*" },
        { action: "shell", resource: "taskctl *" },
        { action: "edit", resource: "reports/*" },
      ],
      status: "active",
      nextRunAt: expect.any(Number),
    })
    const backing = (yield* schedules.list())[0]
    if (!backing?.nextDueAt) return yield* Effect.die("Expected a due backing schedule")
    // The scheduler never admits a hook prompt; it only lets schedule inventories show what the Flow runs.
    expect(backing.action).toEqual({ type: "hook", prompt: "Check the project" })
    expect(yield* context.storage.get(`flow-schedule:v1:${backing.id}`)).toBe(created.output.reference.flowID)
    const mimic = yield* (yield* PluginHooks.Service).trigger("session", "experimental.schedule", {
      sessionID: source.id,
      schedule: { ...backing, id: Schedule.ID.make("sch_mimic") },
    })
    expect(mimic.claimed).toBeUndefined()
    yield* context.storage.set("flow-schedule:v1:sch_stale", "flw_missing")
    const stale = yield* (yield* PluginHooks.Service).trigger("session", "experimental.schedule", {
      sessionID: source.id,
      schedule: { ...backing, id: Schedule.ID.make("sch_stale") },
    })
    expect(stale.claimed).toBeUndefined()
    expect(yield* context.storage.get("flow-schedule:v1:sch_stale")).toBeUndefined()
    const broken = Schema.decodeUnknownSync(KiloFlowRpc.Record)({
      ...record("flw_broken", Schedule.ID.make("sch_broken")),
      context: { directory: source.location.directory, projectID: source.projectID, agent: source.agent },
    })
    yield* context.storage.set(`flow:v1:${broken.id}`, JSON.stringify(broken))
    yield* context.storage.set("flow-schedule:v1:sch_broken", broken.id)
    const failedStart = yield* (yield* PluginHooks.Service)
      .trigger("session", "experimental.schedule", {
        sessionID: source.id,
        schedule: { ...backing, id: Schedule.ID.make("sch_broken") },
      })
      .pipe(Effect.exit)
    // A failed start stays unclaimed so the scheduler keeps the due time and retries it.
    expect(failedStart._tag).toBe("Failure")
    yield* context.storage.remove(`flow:v1:${broken.id}`)
    yield* context.storage.remove("flow-schedule:v1:sch_broken")
    const activeID = KiloFlowRpc.RunID.make("flr_active")
    const active: KiloFlowRpc.Run = {
      version: 1,
      id: activeID,
      flowID: created.output.reference.flowID,
      status: "running",
      worktree: "reuse",
      sessionID: Session.ID.make("ses_active_flow"),
      directory: source.location.directory,
      time: { created: Date.now(), updated: Date.now(), started: Date.now() },
    }
    yield* context.storage.set(`flow-run:v1:${active.flowID}:${active.id}`, JSON.stringify(active))
    yield* context.storage.set(`flow-active:v1:${active.flowID}`, active.id)
    const claimed = yield* (yield* PluginHooks.Service).trigger("session", "experimental.schedule", {
      sessionID: source.id,
      schedule: backing,
    })
    expect(claimed.claimed).toBeTrue()
    const dueAt = DateTime.toEpochMillis(backing.nextDueAt)
    const skippedID = KiloFlowRpc.RunID.make(`flr_${created.output.reference.flowID.slice(4)}_${dueAt}`)
    expect(yield* context.storage.get(`flow-run:v1:${active.flowID}:${skippedID}`)).toContain('"status":"skipped"')
    yield* (yield* PluginHooks.Service).trigger("session", "experimental.schedule", {
      sessionID: source.id,
      schedule: backing,
    })
    expect(
      (yield* context.storage.scan({
        prefix: `flow-run:v1:${created.output.reference.flowID}:`,
      })).entries,
    ).toHaveLength(2)
    yield* Effect.forEach(
      Array.from({ length: 25 }, (_, index) => index),
      (index) =>
        flowRun.execute(
          { flowID: created.output.reference.flowID },
          {
            sessionID: source.id,
            agent: Agent.ID.make("build"),
            messageID: SessionMessage.ID.create(),
            id: Tool.CallID.make(`call_flow_skip_${index}`),
            progress: () => Effect.void,
          },
        ),
      { discard: true },
    )
    expect(
      (yield* context.storage.scan({
        prefix: `flow-run:v1:${created.output.reference.flowID}:`,
      })).entries,
    ).toHaveLength(21)
    // Skipped placeholders keep their own budget of 20, so the active run and real history are never evicted.
    expect(yield* context.storage.get(`flow-run:v1:${active.flowID}:${active.id}`)).toBeDefined()
    yield* context.storage.remove(`flow-run:v1:${active.flowID}:${active.id}`)
    const attempts = yield* Effect.all(
      ["first", "second"].map((name) =>
        flowRun.execute(
          { flowID: created.output.reference.flowID },
          {
            sessionID: source.id,
            agent: Agent.ID.make("build"),
            messageID: SessionMessage.ID.create(),
            id: Tool.CallID.make(`call_flow_run_${name}`),
            progress: () => Effect.void,
          },
        ),
      ),
      { concurrency: "unbounded" },
    )
    expect(attempts.map((attempt) => attempt.output?.status).toSorted()).toEqual(["running", "skipped"])
    const execution = attempts.find((attempt) => attempt.output?.status === "running")
    if (!execution) return yield* Effect.die("Expected one concurrent Flow run to start")
    expect(execution.output).toMatchObject({
      flowID: created.output.reference.flowID,
      status: "running",
      worktree: "reuse",
      directory: source.location.directory,
    })
    if (!execution.output?.sessionID) return yield* Effect.die("Expected flow_run to return a Session ID")
    const permissions = [
      { action: "*", resource: "*", effect: "deny" as const },
      { action: "read", resource: "*", effect: "allow" as const },
      { action: "glob", resource: "*", effect: "allow" as const },
      { action: "grep", resource: "*", effect: "allow" as const },
      { action: "shell", resource: "taskctl *", effect: "allow" as const },
      { action: "edit", resource: "reports/*", effect: "allow" as const },
    ]
    expect(yield* context.session.get({ sessionID: execution.output.sessionID })).toMatchObject({
      id: execution.output.sessionID,
      title: "Flow: Nightly check",
      location: source.location,
      metadata: {
        "kilocode.flow": { flowID: created.output.reference.flowID, runID: execution.output.id },
      },
      permissions,
    })
    const hooks = yield* PluginHooks.Service
    const request = yield* hooks.trigger("session", "context", {
      sessionID: execution.output.sessionID,
      agent: Agent.ID.make("build"),
      model: { providerID: Provider.ID.make("kilo"), id: Model.ID.make("free") },
      system: [{ type: "text", text: "Base instructions" }],
      messages: [],
      options: {},
      tools: {
        write: { description: "Write a file", input: {} },
        shell: { description: "Run a command", input: {} },
        read: { description: "Read a file", input: {} },
      },
    })
    expect(request.system.at(-1)?.text).toContain("Available tools for this run:\n- read\n- shell\n- write")
    expect(request.system.at(-1)?.text).toContain("- shell: taskctl *")
    expect(request.system.at(-1)?.text).toContain("- edit: reports/*")
    // The run Session above fails as soon as it is admitted, because the test has no model. A denied tool call is
    // therefore checked on a second run that the test marks as running on an idle Session.
    yield* context.session.wait({ sessionID: execution.output.sessionID })
    const deniedSession = yield* context.session.create({
      title: "Flow: denied tool",
      agent: Agent.ID.make("build"),
      model: { providerID: Provider.ID.make("kilo"), id: Model.ID.make("free") },
      metadata: { "kilocode.flow": { flowID: created.output.reference.flowID, runID: "flr_denied" } },
    })
    const deniedRun = Schema.decodeUnknownSync(KiloFlowRpc.Run)({
      version: 1,
      id: "flr_denied",
      flowID: created.output.reference.flowID,
      status: "running",
      worktree: "reuse",
      sessionID: deniedSession.id,
      time: { created: 1, updated: 1, started: 1 },
    })
    const deniedKey = `flow-run:v1:${deniedRun.flowID}:${deniedRun.id}`
    yield* context.storage.set(deniedKey, JSON.stringify(deniedRun))
    yield* hooks.trigger("tool", "execute.after", {
      tool: "shell",
      sessionID: deniedSession.id,
      agent: Agent.ID.make("build"),
      messageID: SessionMessage.ID.create(),
      id: Tool.CallID.make("call_flow_denied_shell"),
      input: { command: "otherctl mutate" },
      status: "error",
      error: new Tool.Error({
        message: "Permission denied: shell",
        error: new Permission.BlockedError({
          rules: [{ action: "*", resource: "*", effect: "deny" }],
          permission: "shell",
          resources: ["otherctl mutate"],
        }),
      }),
    })
    expect(yield* context.storage.get(deniedKey)).toContain(
      'Flow permission policy blocked shell for \\"otherctl mutate\\" while running shell',
    )
    yield* context.storage.remove(deniedKey)
    yield* Effect.yieldNow
    expect(yield* list(context, schedules, source.projectID, fs)).toMatchObject({
      flows: [
        {
          name: "Nightly check",
          reference: { type: "managed" },
          status: "active",
          lastRunAt: expect.any(Number),
          lastOutcome: "failed",
          latestRun: {
            id: execution.output.id,
            sessionID: execution.output.sessionID,
            status: "failed",
          },
          health: { status: "healthy" },
        },
      ],
      warnings: [],
    })
    yield* context.storage.set(`flow-run:v1:${created.output.reference.flowID}:bad`, "not json")
    expect((yield* list(context, schedules, source.projectID, fs)).warnings).toEqual([])
    // The latest-run index avoids scanning run records on every poll; a rebuild reports malformed records.
    yield* context.storage.remove(`flow-latest:v1:${created.output.reference.flowID}`)
    expect(yield* list(context, schedules, source.projectID, fs)).toMatchObject({
      warnings: [
        {
          source: "managed-run",
          reference: `flow-run:v1:${created.output.reference.flowID}:bad`,
          message: "Stored Flow run record is malformed or stale",
        },
      ],
    })
    yield* context.storage.remove(`flow-run:v1:${created.output.reference.flowID}:bad`)
    const later = { ...backing, nextDueAt: DateTime.add(backing.nextDueAt, { days: 1 }) }
    const laterID = KiloFlowRpc.RunID.make(
      `flr_${created.output.reference.flowID.slice(4)}_${DateTime.toEpochMillis(later.nextDueAt)}`,
    )
    yield* context.storage.set(
      `flow-run:v1:${created.output.reference.flowID}:${laterID}`,
      JSON.stringify({
        version: 1,
        id: laterID,
        flowID: created.output.reference.flowID,
        status: "skipped",
        worktree: "reuse",
        time: { created: 1, updated: 1, completed: 1 },
      }),
    )
    const retried = yield* hooks.trigger("session", "experimental.schedule", { sessionID: source.id, schedule: later })
    // A slot skipped while another run was active is attempted again when it is re-dispatched.
    expect(retried.claimed).toBeTrue()
    expect(yield* context.storage.get(`flow-run:v1:${created.output.reference.flowID}:${laterID}`)).toContain(
      '"status":"running"',
    )
  }),
)

const call = (sessionID: Session.ID, id: string) => ({
  sessionID,
  agent: Agent.ID.make("build"),
  messageID: SessionMessage.ID.create(),
  id: Tool.CallID.make(id),
  progress: () => Effect.void,
})

recording.live("lists, updates, and deletes Flows through the agent tools, approving only changed permissions", () =>
  Effect.gen(function* () {
    backingSchedules.clear()
    approvals.length = 0
    const plugins = yield* Plugin.Service
    const context = yield* PluginHost.make(plugins, "test")
    const schedules = yield* Schedule.Service
    yield* KiloFlowPlugin.effect(context)
    const tools = yield* Tool.Service
    const registered = yield* tools.list()
    const tool = (name: string) => {
      const found = registered.find((item) => item.id === name)
      if (!found) throw new Error(`Expected ${name} to be registered`)
      return found
    }
    const source = yield* context.session.create({
      title: "Flow source",
      agent: Agent.ID.make("build"),
      model: { providerID: Provider.ID.make("kilo"), id: Model.ID.make("free") },
    })
    const created = yield* tool("flow_create").execute(
      {
        name: "Weekly report",
        when: { every: "7 days", tz: "UTC" },
        ends: { times: 4 },
        prompt: "Write the report",
        worktree: "reuse",
        permissions: [{ action: "shell", resource: "taskctl *" }],
      },
      call(source.id, "call_create_report"),
    )
    if (created.output?.reference.type !== "managed" || !created.output.reference.scheduleID)
      return yield* Effect.die("Expected a managed Flow with a schedule")
    const flowID = created.output.reference.flowID
    const firstScheduleID = created.output.reference.scheduleID
    expect(created.output).toMatchObject({ ends: { times: 4 }, remainingRuns: 4 })
    expect(approvals).toHaveLength(1)

    const listed = yield* tool("flow_list").execute({}, call(source.id, "call_list"))
    expect(listed.content).toContain(flowID)
    expect(listed.content).toContain("every 7 days")

    // Text-only changes keep the backing schedule and ask for nothing.
    const renamed = yield* tool("flow_update").execute(
      { flowID, name: "Weekly summary", prompt: "Summarize the week" },
      call(source.id, "call_rename"),
    )
    expect(renamed.output).toMatchObject({
      name: "Weekly summary",
      prompt: "Summarize the week",
      reference: { scheduleID: firstScheduleID },
    })
    expect(approvals).toHaveLength(1)

    // A new trigger replaces the backing row, keeps the pause, and moves the schedule index.
    yield* schedules.pause(firstScheduleID)
    const rescheduled = yield* tool("flow_update").execute(
      { flowID, when: { cron: "0 9 * * 1" }, ends: null },
      call(source.id, "call_reschedule"),
    )
    if (rescheduled.output?.reference.type !== "managed") return yield* Effect.die("Expected a managed Flow")
    const secondScheduleID = rescheduled.output.reference.scheduleID
    expect(secondScheduleID).toBeDefined()
    expect(secondScheduleID).not.toBe(firstScheduleID)
    expect(rescheduled.output).toMatchObject({
      status: "paused",
      trigger: { when: { type: "cron", cron: "0 9 * * 1", tz: "UTC" } },
    })
    expect(rescheduled.output.ends).toBeUndefined()
    expect(backingSchedules.has(firstScheduleID)).toBeFalse()
    expect(backingSchedules.get(secondScheduleID!)?.action).toEqual({ type: "hook", prompt: "Summarize the week" })
    expect(yield* context.storage.get(`flow-schedule:v1:${firstScheduleID}`)).toBeUndefined()
    expect(yield* context.storage.get(`flow-schedule:v1:${secondScheduleID}`)).toBe(flowID)
    expect(approvals).toHaveLength(1)

    // A changed allowlist is approved again before it is stored; the same allowlist is not.
    yield* tool("flow_update").execute(
      { flowID, permissions: [{ action: "shell", resource: "taskctl *" }] },
      call(source.id, "call_same_permissions"),
    )
    expect(approvals).toHaveLength(1)
    const widened = yield* tool("flow_update").execute(
      {
        flowID,
        permissions: [
          { action: "shell", resource: "taskctl *" },
          { action: "edit", resource: "reports/*" },
        ],
      },
      call(source.id, "call_widen"),
    )
    expect(approvals).toHaveLength(2)
    expect(approvals[1]).toMatchObject({
      action: "flow",
      sessionID: source.id,
      resources: ["read: *", "glob: *", "grep: *", "shell: taskctl *", "edit: reports/*"],
    })
    expect(widened.output?.permissions).toContainEqual({ action: "edit", resource: "reports/*" })
    const invalid = yield* tool("flow_update")
      .execute({ flowID, permissions: [{ action: "*", resource: "*" }] }, call(source.id, "call_invalid_update"))
      .pipe(Effect.flip)
    expect(invalid.message).toContain("must name one concrete capability")
    expect(approvals).toHaveLength(2)
    // Removing a pattern is a change too: the user approves the narrower allowlist that will be stored.
    const narrowed = yield* tool("flow_update").execute(
      { flowID, permissions: [{ action: "shell", resource: "taskctl *" }] },
      call(source.id, "call_narrow"),
    )
    expect(approvals).toHaveLength(3)
    expect(approvals[2]).toMatchObject({ resources: ["read: *", "glob: *", "grep: *", "shell: taskctl *"] })
    expect(narrowed.output?.permissions).not.toContainEqual({ action: "edit", resource: "reports/*" })

    // A Flow run Session has a deny-by-default allowlist, so it must not manage the project's other Flows.
    const run = yield* tool("flow_run").execute({ flowID }, call(source.id, "call_run"))
    if (!run.output?.sessionID) return yield* Effect.die("Expected flow_run to return a Session ID")
    const runSession = run.output.sessionID
    const refusedUpdate = yield* tool("flow_update")
      .execute({ flowID, name: "Renamed by a run" }, call(runSession, "call_run_update"))
      .pipe(Effect.flip)
    expect(refusedUpdate.message).toContain("runs a Flow and cannot")
    const refusedDelete = yield* tool("flow_delete")
      .execute({ flowID }, call(runSession, "call_run_delete"))
      .pipe(Effect.flip)
    expect(refusedDelete.message).toContain("runs a Flow and cannot")
    const refusedRun = yield* tool("flow_run").execute({ flowID }, call(runSession, "call_run_run")).pipe(Effect.flip)
    expect(refusedRun.message).toContain("runs a Flow and cannot")
    const refusedCreate = yield* tool("flow_create")
      .execute(
        { name: "Escalate", when: { every: "1 day", tz: "UTC" }, prompt: "Do more", worktree: "reuse", permissions: [] },
        call(runSession, "call_run_create"),
      )
      .pipe(Effect.flip)
    expect(refusedCreate.message).toContain("runs a Flow and cannot")
    const refusedList = yield* tool("flow_list").execute({}, call(runSession, "call_run_list")).pipe(Effect.flip)
    expect(refusedList.message).toContain("runs a Flow and cannot")
    expect(approvals).toHaveLength(3)

    const removed = yield* tool("flow_delete").execute({ flowID }, call(source.id, "call_delete"))
    expect(removed.output).toEqual({})
    expect(yield* context.storage.get(`flow:v1:${flowID}`)).toBeUndefined()
    expect(backingSchedules.size).toBe(0)
  }),
)

it.live("pauses a scheduled Flow whose directory no longer exists instead of retrying it", () =>
  Effect.gen(function* () {
    backingSchedules.clear()
    const plugins = yield* Plugin.Service
    const context = yield* PluginHost.make(plugins, "test")
    const schedules = yield* Schedule.Service
    const fs = yield* FSUtil.Service
    yield* KiloFlowPlugin.effect(context)
    const source = yield* context.session.create({
      title: "Flow source",
      agent: Agent.ID.make("build"),
      model: { providerID: Provider.ID.make("kilo"), id: Model.ID.make("free") },
    })
    const backing = yield* schedules.create({
      sessionID: source.id,
      name: "Flow: Gone",
      when: { type: "every", every: "1 hour" },
      action: { type: "hook", prompt: "Clean up" },
    })
    const gone = Schema.decodeUnknownSync(KiloFlowRpc.Record)({
      ...record("flw_gone", backing.id),
      context: {
        directory: "/definitely/missing/flow/directory",
        projectID: source.projectID,
        sessionID: source.id,
        model: source.model,
        agent: source.agent,
      },
    })
    yield* context.storage.set(`flow:v1:${gone.id}`, JSON.stringify(gone))
    yield* context.storage.set(`flow-schedule:v1:${backing.id}`, gone.id)

    const result = yield* (yield* PluginHooks.Service).trigger("session", "experimental.schedule", {
      sessionID: source.id,
      schedule: backing,
    })
    expect(result.claimed).toBeTrue()
    expect(backingSchedules.get(backing.id)?.status).toBe("paused")
    const listed = (yield* list(context, schedules, source.projectID, fs)).flows.find(
      (flow) => flow.reference.type === "managed" && flow.reference.flowID === gone.id,
    )
    expect(listed).toMatchObject({
      status: "paused",
      health: { status: "error", message: "Flow directory /definitely/missing/flow/directory no longer exists" },
      latestRun: { status: "failed", error: "Flow directory /definitely/missing/flow/directory no longer exists" },
    })
  }),
)

it.live("retries an occurrence in the worktree it kept and removes only with force off", () =>
  Effect.gen(function* () {
    backingSchedules.clear()
    const plugins = yield* Plugin.Service
    const context = yield* PluginHost.make(plugins, "test")
    const schedules = yield* Schedule.Service
    const fs = yield* FSUtil.Service
    const source = yield* context.session.create({
      title: "Flow source",
      agent: Agent.ID.make("build"),
      model: { providerID: Provider.ID.make("kilo"), id: Model.ID.make("free") },
    })
    const scratch = mkdtempSync(path.join(tmpdir(), "flow-worktrees-"))
    const created: string[] = []
    const removals: { directory: string; force: boolean }[] = []
    // The first removal is refused, as git refuses a worktree with changes; later ones succeed.
    const worktree = {
      ...context.worktree,
      list: () => Effect.succeed([{ directory: AbsolutePath.make(source.location.directory) }]),
      create: () =>
        Effect.sync(() => {
          const directory = mkdtempSync(path.join(scratch, "run-"))
          created.push(directory)
          return { directory: AbsolutePath.make(directory) }
        }),
      remove: (input: { directory: AbsolutePath; force: boolean }) => {
        removals.push({ directory: input.directory, force: input.force })
        return removals.length === 1 ? Effect.fail(new Error("worktree has changes")) : Effect.void
      },
    }
    // Every start fails before its Session exists.
    const session = { ...context.session, create: () => Effect.fail(new Error("model unavailable")) }
    const flaky = { ...context, worktree, session } as typeof context
    const backing = yield* schedules.create({
      sessionID: source.id,
      name: "Flow: Retry",
      when: { type: "every", every: "1 hour" },
      action: { type: "hook", prompt: "Retry" },
    })
    const retry = Schema.decodeUnknownSync(KiloFlowRpc.Record)({
      ...record("flw_retry", backing.id),
      context: {
        directory: source.location.directory,
        projectID: source.projectID,
        sessionID: source.id,
        model: source.model,
        agent: source.agent,
      },
    })
    yield* context.storage.set(`flow:v1:${retry.id}`, JSON.stringify(retry))
    const runtime = { fs, locks: new Map(), changed: () => Effect.void }
    const runKey = `flow-run:v1:${retry.id}:flr_retry_${DateTime.toEpochMillis(backing.nextDueAt!)}`
    const stored = () =>
      context.storage.get(runKey).pipe(Effect.map((value) => Schema.decodeUnknownSync(KiloFlowRpc.Run)(JSON.parse(String(value)))))

    // A refused removal keeps the worktree recorded on the failed run.
    expect((yield* scheduled(flaky, schedules, backing, retry.id, runtime).pipe(Effect.exit))._tag).toBe("Failure")
    expect(created).toHaveLength(1)
    expect(yield* stored()).toMatchObject({ status: "failed", worktreeDirectory: created[0] })

    // The retry of the same occurrence reuses it instead of creating another, and removes it once the start fails.
    expect((yield* scheduled(flaky, schedules, backing, retry.id, runtime).pipe(Effect.exit))._tag).toBe("Failure")
    expect(created).toHaveLength(1)
    expect(removals).toEqual([
      { directory: created[0], force: false },
      { directory: created[0], force: false },
    ])
    expect((yield* stored()).worktreeDirectory).toBeUndefined()
  }),
)

test("labels a native row with the action that owns it", () => {
  const hooked: Schedule.Info = {
    ...schedule({ id: "sch_wakeup", sessionID: session.id }),
    name: "Wakeup: check the build",
    action: { type: "hook", prompt: "check the build" },
  }
  const output = assemble({
    records: [],
    schedules: [schedule({ id: "sch_prompt", sessionID: session.id }), hooked],
    sessions: new Map([
      [Schedule.ID.make("sch_prompt"), session],
      [hooked.id, session],
    ]),
    warnings: [],
    observedAt: 100,
  })
  expect(output.flows.map((flow) => flow.reference)).toEqual([
    { type: "native-schedule", scheduleID: Schedule.ID.make("sch_prompt"), action: "prompt" },
    { type: "native-schedule", scheduleID: hooked.id, action: "hook" },
  ])
  expect(output.flows[1]?.prompt).toBe("check the build")
})
