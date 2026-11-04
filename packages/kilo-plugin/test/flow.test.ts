import { expect, test } from "bun:test"
import { Agent } from "@opencode/core/agent"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { Provider } from "@opencode/core/provider"
import { Schedule } from "@opencode/core/schedule"
import { Tool } from "@opencode/core/tool"
import { assemble, list, permissionInstructions, storedRecord } from "../src/flow"
import { KiloFlowPlugin } from "../src/flow"
import { KiloFlowRpc } from "@opencode/schema/kilocode/flow"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { DateTime, Effect, Layer, Schema } from "effect"
import { testEffect } from "../../core/test/lib/effect"
import { PluginTestLayer } from "../../core/test/plugin/fixture"

const backingSchedules = new Map<Schedule.ID, Schedule.Info>()
let scheduleCounter = 0

const it = testEffect(
  Layer.merge(
    PluginTestLayer,
    Layer.mock(Schedule.Service, {
      list: () => Effect.succeed([...backingSchedules.values()]),
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
            runCount: 0,
            time: { created: now, updated: now },
          })
          backingSchedules.set(schedule.id, schedule)
          return schedule
        }),
      remove: (scheduleID) => Effect.sync(() => backingSchedules.delete(scheduleID)).pipe(Effect.asVoid),
    }),
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

test("describes the exact unattended permission contract to a Flow executor", () => {
  expect(
    permissionInstructions([
      { action: "shell", resource: "git *" },
      { action: "edit", resource: "/home/user/status.txt" },
      { action: "external_directory", resource: "/home/user/*" },
    ]),
  ).toBe(
    [
      "You are running an unattended Flow. No user is present to approve additional permissions.",
      "Approved permission patterns:",
      "- shell: git *",
      "- edit: /home/user/status.txt",
      "- external_directory: /home/user/*",
      "Permission resources are wildcard patterns matched against actual tool requests. Choose tool inputs that match these patterns exactly.",
      "For shell calls, every parsed command in a compound command must match an approved shell pattern. Prefer dedicated read, edit, or write tools over shell redirection when their actions are approved.",
      "Do not make exploratory or preflight tool calls outside the allowlist, and do not work around or repeatedly retry a denied operation. If the allowlist cannot complete the task, report the missing action and resource.",
    ].join("\n"),
  )
})

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
})

it.live("registers and executes the managed Flow creation and run tools", () =>
  Effect.gen(function* () {
    backingSchedules.clear()
    scheduleCounter = 0
    const plugins = yield* Plugin.Service
    const context = yield* PluginHost.make(plugins)
    const schedules = yield* Schedule.Service
    yield* KiloFlowPlugin.effect(context)
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
          permissions: [{ action: "external_directory", resource: "/*" }],
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
    expect(invalid.message).toContain("must use a bounded wildcard")
    const created = yield* flowCreate.execute(
      {
        name: "Nightly check",
        when: { every: "1 day", tz: "UTC" },
        prompt: "Check the project",
        worktree: "reuse",
        permissions: [],
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
      status: "active",
      nextRunAt: expect.any(Number),
    })
    const backing = (yield* schedules.list())[0]
    if (!backing?.nextDueAt) return yield* Effect.die("Expected a due backing schedule")
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
    yield* context.storage.remove(`flow-run:v1:${active.flowID}:${active.id}`)
    const execution = yield* flowRun.execute(
      { flowID: created.output.reference.flowID },
      {
        sessionID: source.id,
        agent: Agent.ID.make("build"),
        messageID: SessionMessage.ID.create(),
        id: Tool.CallID.make("call_flow_run"),
        progress: () => Effect.void,
      },
    )
    expect(execution.output).toMatchObject({
      flowID: created.output.reference.flowID,
      status: "running",
      worktree: "reuse",
      directory: source.location.directory,
    })
    if (!execution.output?.sessionID) return yield* Effect.die("Expected flow_run to return a Session ID")
    const permissions = [
      { action: "*", resource: "*", effect: "deny" as const },
      { action: "shell", resource: "git *", effect: "allow" as const },
      { action: "edit", resource: "/home/user/status.txt", effect: "allow" as const },
    ]
    yield* context.session.update({ sessionID: execution.output.sessionID, permissions })
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
      tools: {},
    })
    expect(request.system.at(-1)?.text).toContain("- shell: git *")
    expect(request.system.at(-1)?.text).toContain("- edit: /home/user/status.txt")
    yield* context.session.wait({ sessionID: execution.output.sessionID })
    expect(yield* context.session.get({ sessionID: execution.output.sessionID })).toMatchObject({ outcome: "failed" })
    yield* Effect.yieldNow
    expect(yield* list(context, schedules)).toMatchObject({
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
    yield* context.storage.set("flow-run:v1:bad", "not json")
    expect(yield* list(context, schedules)).toMatchObject({
      warnings: [
        {
          source: "managed-run",
          reference: "flow-run:v1:bad",
          message: "Stored Flow run record is malformed or stale",
        },
      ],
    })
  }),
)
