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
import { assemble, flowPermissions, list, permissionInstructions, storedRecord } from "../src/flow"
import { KiloFlowPlugin } from "../src/flow"
import { validatePermissions } from "../src/flow/permissions"
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

it.live("registers and executes the managed Flow creation and run tools", () =>
  Effect.gen(function* () {
    backingSchedules.clear()
    scheduleCounter = 0
    const plugins = yield* Plugin.Service
    const context = yield* PluginHost.make(plugins)
    const schedules = yield* Schedule.Service
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
    expect(yield* context.storage.get(`flow-schedule:v1:${backing.id}`)).toBe(created.output.reference.flowID)
    const mimic = yield* (yield* PluginHooks.Service).trigger("session", "experimental.schedule", {
      sessionID: source.id,
      schedule: { ...backing, id: Schedule.ID.make("sch_mimic") },
    })
    expect(mimic.claimed).toBeUndefined()
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
    ).toHaveLength(20)
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
    yield* hooks.trigger("tool", "execute.after", {
      tool: "shell",
      sessionID: execution.output.sessionID,
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
    expect(yield* context.storage.get(`flow-run:v1:${execution.output.flowID}:${execution.output.id}`)).toContain(
      'Flow permission policy blocked shell for \\"otherctl mutate\\" while running shell',
    )
    yield* context.session.wait({ sessionID: execution.output.sessionID })
    expect(yield* context.session.get({ sessionID: execution.output.sessionID })).toMatchObject({
      outcome: "interrupted",
    })
    yield* Effect.yieldNow
    expect(yield* list(context, schedules, source.projectID)).toMatchObject({
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
    expect(yield* list(context, schedules, source.projectID)).toMatchObject({
      warnings: [
        {
          source: "managed-run",
          reference: `flow-run:v1:${created.output.reference.flowID}:bad`,
          message: "Stored Flow run record is malformed or stale",
        },
      ],
    })
  }),
)
