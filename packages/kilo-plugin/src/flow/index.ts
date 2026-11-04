import path from "node:path"
import { define } from "@opencode/plugin/effect/plugin"
import type { Plugin } from "@opencode/plugin/effect"
import { Schedule } from "@opencode/core/schedule"
import type { Agent } from "@opencode/schema/agent"
import { KiloFlowRpc } from "@opencode/schema/kilocode/flow"
import type { Model } from "@opencode/schema/model"
import { AbsolutePath } from "@opencode/schema/schema"
import { Session } from "@opencode/schema/session"
import type { SessionEvent } from "@opencode/schema/session-event"
import { Tool } from "@opencode/schema/tool"
import { FSUtil } from "@opencode/util/fs-util"
import { Cause, DateTime, Effect, Option, Schema, Stream } from "effect"

const prefix = "flow:v1:"
const runPrefix = "flow-run:v1:"
const metadataKey = "kilocode.flow"
const permissionAction = "flow"
const scheduledPromptPrefix = "[Kilo managed Flow "
const decodeRecord = Schema.decodeUnknownOption(
  Schema.Union([KiloFlowRpc.Record, Schema.fromJsonString(KiloFlowRpc.Record)]),
)
const decodeRun = Schema.decodeUnknownOption(Schema.Union([KiloFlowRpc.Run, Schema.fromJsonString(KiloFlowRpc.Run)]))
const decodeFlowID = Schema.decodeUnknownOption(KiloFlowRpc.ID)
const decodeMetadata = Schema.decodeUnknownOption(Schema.Struct({ flowID: KiloFlowRpc.ID, runID: KiloFlowRpc.RunID }))
const decodeBlockedPermission = Schema.decodeUnknownOption(
  Schema.Struct({ _tag: Schema.Literal("Permission.BlockedError") }),
)

export const KiloFlowPlugin = define({
  id: "kilocode.flow",
  effect: Effect.fn(function* (ctx) {
    const schedules = yield* Schedule.Service
    const selections = new Map<Session.ID, { readonly model: Model.Ref; readonly agent: Agent.ID }>()
    const background = new Set<Session.ID>()
    yield* ctx.session.hook("experimental.schedule", (event) =>
      scheduled(ctx, event.schedule).pipe(
        Effect.tap((outcome) =>
          Effect.sync(() => {
            if (outcome !== undefined) event.claimed = true
          }),
        ),
      ),
    )
    yield* ctx.session.hook("context", (event) =>
      Effect.gen(function* () {
        selections.set(event.sessionID, { model: event.model, agent: event.agent })
        const session = yield* ctx.session.get({ sessionID: event.sessionID })
        if (Option.isNone(decodeMetadata(session.metadata?.[metadataKey]))) return
        event.system.push({
          type: "text",
          text: permissionInstructions(
            (session.permissions ?? []).filter((permission) => permission.effect === "allow"),
          ),
        })
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("failed to add Flow permission instructions", { sessionID: event.sessionID, cause }),
        ),
      ),
    )
    yield* ctx.session.hook("experimental.idle", (event) =>
      Effect.sync(() => {
        selections.delete(event.sessionID)
        if (event.background.some((item) => item.sessionID === event.sessionID)) background.add(event.sessionID)
        else background.delete(event.sessionID)
      }),
    )
    yield* ctx.permission.hook("evaluate", (event) =>
      Effect.sync(() => {
        if (event.action !== permissionAction || event.metadata?.[metadataKey] === undefined) return
        event.effect = "ask"
        event.message = `Approve this Flow's unattended permissions:\n${event.resources.map((resource) => `- ${resource}`).join("\n")}`
      }),
    )
    yield* ctx.tool.hook("execute.after", (event) => {
      if (event.status !== "error" || Option.isNone(decodeBlockedPermission(event.error.error))) return Effect.void
      return permissionFailed(ctx, event.sessionID, event.tool, event.error.message)
    })
    yield* ctx.event
      .subscribe({
        types: ["session.execution.succeeded", "session.execution.failed", "session.execution.interrupted"],
      })
      .pipe(
        Stream.runForEach((event) => {
          selections.delete(event.data.sessionID)
          return complete(ctx, event, background)
        }),
        Effect.forkScoped({ startImmediately: true }),
      )
    yield* ctx.rpc
      .register(KiloFlowRpc.Definition, {
        list: () => list(ctx, schedules),
        create: (input, context) =>
          create(ctx, schedules, input, ctx.location.project.id).pipe(
            Effect.mapError((error) => context.error("failed", error.message)),
          ),
        run: (input, context) =>
          run(ctx, input, ctx.location.project.id).pipe(
            Effect.mapError((error) => context.error("failed", error.message)),
          ),
      })
      .pipe(Effect.orDie)
    yield* ctx.tool
      .transform((editor) => {
        editor.add({
          name: "flow_create",
          description:
            "Create a scheduled managed local Flow from this Session. Before calling, derive the complete minimum unattended permission allowlist from the Flow prompt. Resources are wildcard patterns matched against actual tool requests, not descriptions of intent. Shell grants must cover each possible parsed command and stable invocation form: prefer a bounded executable family such as `git *` when flags or working-directory arguments may vary, and include helper commands such as `date *` or `echo *` when needed. File writes use edit. Paths outside the Flow directory also need external_directory with a directory wildcard such as `/home/user/*`; an exact directory path does not cover its contents. Avoid unrestricted `shell: *`. Use an empty list only when the prompt needs no tools. The user reviews the exact allowlist before the Flow is stored. The executor receives this same allowlist as a constraint. The Flow appears in /periodic, runs automatically on its schedule, and can also be started manually with flow_run.",
          input: KiloFlowRpc.CreateRequest,
          output: KiloFlowRpc.Info,
          options: { codemode: true },
          execute: (input, context) => {
            const selection = selections.get(context.sessionID)
            return create(
              ctx,
              schedules,
              {
                ...input,
                sourceSessionID: context.sessionID,
                model: input.model ?? selection?.model,
                agent: input.agent ?? selection?.agent ?? context.agent,
              },
              undefined,
            ).pipe(
              Effect.map((flow) => ({
                output: flow,
                content: `Created scheduled Flow ${flow.name} with ${permissionSummary(input.permissions)}. Start an extra run manually with flow_run using Flow ID ${flow.reference.type === "managed" ? flow.reference.flowID : "unknown"}.`,
              })),
              Effect.mapError(
                (error) => new Tool.Error({ message: error instanceof Error ? error.message : String(error), error }),
              ),
            )
          },
        })
        editor.add({
          name: "flow_run",
          description:
            "Start one manual execution of a managed local Flow. Creates a fresh Session, creating a worktree first when the Flow requests one, and returns the new Session ID.",
          input: KiloFlowRpc.RunInput,
          output: KiloFlowRpc.Run,
          options: { codemode: true },
          execute: (input, context) =>
            ctx.session.get({ sessionID: context.sessionID }).pipe(
              Effect.flatMap((session) => run(ctx, input, session.projectID)),
              Effect.map((execution) => ({
                output: execution,
                content:
                  execution.status === "failed"
                    ? `Flow ${execution.flowID} failed to start: ${execution.error ?? "unknown error"}`
                    : execution.status === "skipped"
                      ? `Skipped Flow ${execution.flowID} because another execution is active.`
                      : `Started Flow ${execution.flowID} in Session ${execution.sessionID}.`,
              })),
              Effect.mapError(
                (error) => new Tool.Error({ message: error instanceof Error ? error.message : String(error), error }),
              ),
            ),
        })
      })
      .pipe(Effect.orDie)
  }),
})

export function create(
  ctx: Plugin.Context,
  schedules: Pick<Schedule.Interface, "create" | "remove">,
  input: KiloFlowRpc.CreateInput,
  projectID: Session.Info["projectID"] | undefined,
): Effect.Effect<KiloFlowRpc.Info, Error> {
  return Effect.gen(function* () {
    const session = yield* ctx.session
      .get({ sessionID: input.sourceSessionID })
      .pipe(Effect.mapError(() => new Error(`Source Session ${input.sourceSessionID} does not exist`)))
    if (projectID !== undefined && session.projectID !== projectID)
      return yield* Effect.fail(new Error(`Source Session ${input.sourceSessionID} does not exist`))
    const model = input.model ?? session.model
    const agent = input.agent ?? session.agent
    if (!model) return yield* Effect.fail(new Error("The source Session has no model; provide one explicitly"))
    if (!agent) return yield* Effect.fail(new Error("The source Session has no agent; provide one explicitly"))
    const external = input.permissions.find(
      (permission) =>
        permission.action === "external_directory" &&
        ((!permission.resource.includes("*") && !permission.resource.includes("?")) ||
          /^[\\/][*?]/.test(permission.resource) ||
          /^[A-Za-z]:[\\/][*?]/.test(permission.resource)),
    )
    if (external)
      return yield* Effect.fail(
        new Error(`external_directory permission ${external.resource} must use a bounded wildcard below a directory`),
      )
    const now = Date.now()
    const record: KiloFlowRpc.Record = {
      version: 1,
      id: KiloFlowRpc.ID.create(),
      name: input.name,
      authority: { type: "local" },
      trigger: {
        type: "time",
        when: time(input.when),
        timezone: input.when.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      execution: {
        type: "local",
        mode: "fresh",
        sourceSessionID: session.id,
        worktree: input.worktree,
      },
      context: {
        directory: session.location.directory,
        projectID: session.projectID,
        sessionID: session.id,
        model,
        agent,
      },
      prompt: input.prompt,
      permissions: input.permissions,
      time: { created: now, updated: now },
    }
    yield* ctx.permission.assert({
      action: permissionAction,
      resources:
        input.permissions.length === 0
          ? ["no unattended tool permissions"]
          : input.permissions.map((permission) => `${permission.action}: ${permission.resource}`),
      sessionID: session.id,
      agent,
      metadata: {
        [metadataKey]: {
          flowID: record.id,
          name: record.name,
          permissions: input.permissions,
          unattended: true,
        },
      },
    })
    const key = `${prefix}${record.id}`
    yield* ctx.storage
      .set(key, JSON.stringify(record))
      .pipe(Effect.mapError(() => new Error(`Couldn't save Flow ${record.id}`)))
    const schedule = yield* schedules
      .create(
        {
          sessionID: session.id,
          name: `Flow: ${record.name}`,
          when: record.trigger.when,
          action: { type: "prompt", prompt: scheduledPrompt(record.id) },
        },
        { requireEnabled: false },
      )
      .pipe(
        Effect.mapError((error) => new Error(`Couldn't schedule Flow ${record.id}: ${error.message}`)),
        Effect.onError(() => ctx.storage.remove(key).pipe(Effect.ignore)),
      )
    const configured: KiloFlowRpc.Record = {
      ...record,
      scheduleID: schedule.id,
      time: { ...record.time, updated: Date.now() },
    }
    yield* ctx.storage.set(key, JSON.stringify(configured)).pipe(
      Effect.mapError(() => new Error(`Couldn't save backing schedule for Flow ${record.id}`)),
      Effect.onError(() =>
        schedules.remove(schedule.id).pipe(Effect.ignore, Effect.andThen(ctx.storage.remove(key).pipe(Effect.ignore))),
      ),
    )
    return managed(configured, schedule)
  })
}

export function run(
  ctx: Plugin.Context,
  input: KiloFlowRpc.RunInput,
  authorizedProjectID: Session.Info["projectID"],
): Effect.Effect<KiloFlowRpc.Run, Error> {
  return Effect.gen(function* () {
    const value = yield* ctx.storage.get(`${prefix}${input.flowID}`)
    const record = Option.getOrUndefined(decodeRecord(value))
    if (!record || record.id !== input.flowID || record.context.projectID !== authorizedProjectID)
      return yield* Effect.fail(new Error(`Flow ${input.flowID} does not exist`))
    return yield* start(ctx, record, KiloFlowRpc.RunID.create())
  })
}

export function scheduled(
  ctx: Plugin.Context,
  schedule: Schedule.Info,
): Effect.Effect<"fired" | "skipped" | "failed" | undefined> {
  const flowID = scheduledFlowID(schedule)
  if (flowID === undefined) return Effect.succeed(undefined)
  return Effect.gen(function* () {
    const record = Option.getOrUndefined(decodeRecord(yield* ctx.storage.get(`${prefix}${flowID}`)))
    if (!record || record.id !== flowID || (record.scheduleID !== undefined && record.scheduleID !== schedule.id))
      return yield* Effect.fail(new Error(`Backing schedule ${schedule.id} has no matching Flow ${flowID}`))
    if (schedule.nextDueAt === undefined)
      return yield* Effect.fail(new Error(`Backing schedule ${schedule.id} has no due time`))
    const dueAt = DateTime.toEpochMillis(schedule.nextDueAt)
    const execution = yield* start(ctx, record, KiloFlowRpc.RunID.make(`flr_${record.id.slice(4)}_${dueAt}`), {
      scheduleID: schedule.id,
      dueAt,
    })
    if (execution.status === "skipped") return "skipped"
    if (execution.status === "failed") return "failed"
    return "fired"
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logError("scheduled Flow failed to dispatch", { scheduleID: schedule.id, flowID, cause }).pipe(
        Effect.as("failed" as const),
      ),
    ),
  )
}

function start(
  ctx: Plugin.Context,
  record: KiloFlowRpc.Record,
  runID: KiloFlowRpc.RunID,
  scheduled?: KiloFlowRpc.ScheduledOccurrence,
): Effect.Effect<KiloFlowRpc.Run, Error> {
  return Effect.gen(function* () {
    const directory = record.context.directory
    const projectID = record.context.projectID
    const model = record.context.model
    const agent = record.context.agent
    if (!directory || !projectID || !model || !agent)
      return yield* Effect.fail(new Error(`Flow ${record.id} is missing execution context`))

    const key = runKey({ flowID: record.id, id: runID })
    const existing = Option.getOrUndefined(decodeRun(yield* ctx.storage.get(key)))
    if (existing?.flowID === record.id && existing.id === runID) return existing

    const now = Date.now()
    const active = (yield* runs(ctx)).runs.find(
      (run) => run.flowID === record.id && (run.status === "starting" || run.status === "running"),
    )
    if (active) {
      const skipped: KiloFlowRpc.Run = {
        version: 1,
        id: runID,
        flowID: record.id,
        status: "skipped",
        worktree: record.execution.worktree,
        ...(scheduled ? { scheduled } : {}),
        time: { created: now, updated: now, completed: now },
      }
      yield* ctx.storage.set(key, JSON.stringify(skipped))
      return skipped
    }
    const initial: KiloFlowRpc.Run = {
      version: 1,
      id: runID,
      flowID: record.id,
      status: "starting",
      worktree: record.execution.worktree,
      ...(scheduled ? { scheduled } : {}),
      time: { created: now, updated: now },
    }
    yield* ctx.storage.set(key, JSON.stringify(initial))

    const targetResult = yield* (
      record.execution.worktree === "new"
        ? Effect.gen(function* () {
            const source = (yield* ctx.worktree.list({ projectID }))
              .filter((worktree) => FSUtil.contains(worktree.directory, directory))
              .toSorted((left, right) => right.directory.length - left.directory.length)[0]
            if (!source) return yield* Effect.fail(new Error(`Flow directory ${directory} has no containing worktree`))
            const worktree = yield* ctx.worktree.create({
              projectID,
              from: source.directory,
              name: `${record.id}-${initial.id}`,
            })
            return AbsolutePath.make(path.resolve(worktree.directory, path.relative(source.directory, directory)))
          })
        : Effect.succeed(directory)
    ).pipe(
      Effect.onInterrupt(() => failRun(ctx, initial, key, new Error("Flow start was interrupted")).pipe(Effect.asVoid)),
      Effect.result,
    )
    if (targetResult._tag === "Failure") return yield* failRun(ctx, initial, key, targetResult.failure)

    const sessionResult = yield* ctx.session
      .create({
        title: `Flow: ${record.name}`,
        agent,
        model,
        location: { directory: targetResult.success },
        metadata: { [metadataKey]: { flowID: record.id, runID: initial.id } },
        permissions: [
          { action: "*", resource: "*", effect: "deny" },
          ...(record.permissions ?? []).map((permission) => ({ ...permission, effect: "allow" as const })),
        ],
      })
      .pipe(
        Effect.onInterrupt(() =>
          failRun(ctx, initial, key, new Error("Flow start was interrupted")).pipe(Effect.asVoid),
        ),
        Effect.result,
      )
    if (sessionResult._tag === "Failure") return yield* failRun(ctx, initial, key, sessionResult.failure)

    const started = Date.now()
    const running: KiloFlowRpc.Run = {
      ...initial,
      status: "running",
      sessionID: sessionResult.success.id,
      directory: targetResult.success,
      time: { ...initial.time, updated: started, started },
    }
    yield* ctx.storage.set(key, JSON.stringify(running))
    const prompted = yield* ctx.session.prompt({ sessionID: sessionResult.success.id, text: record.prompt }).pipe(
      Effect.onInterrupt(() => failRun(ctx, running, key, new Error("Flow start was interrupted")).pipe(Effect.asVoid)),
      Effect.result,
    )
    if (prompted._tag === "Failure") return yield* failRun(ctx, running, key, prompted.failure)
    return running
  })
}

function failRun(ctx: Plugin.Context, run: KiloFlowRpc.Run, key: string, error: unknown) {
  const completed = Date.now()
  const failed: KiloFlowRpc.Run = {
    ...run,
    status: "failed",
    error: Cause.pretty(Cause.fail(error)),
    time: { ...run.time, updated: completed, completed },
  }
  return ctx.storage.set(key, JSON.stringify(failed)).pipe(Effect.as(failed))
}

export function list(
  ctx: Plugin.Context,
  schedules: Pick<Schedule.Interface, "list">,
): Effect.Effect<KiloFlowRpc.ListOutput> {
  return Effect.gen(function* () {
    const observedAt = Date.now()
    const nativeResult = yield* schedules.list().pipe(Effect.result)
    const native = nativeResult._tag === "Success" ? nativeResult.success : []
    const nativeWarnings: KiloFlowRpc.Warning[] =
      nativeResult._tag === "Failure"
        ? [
            {
              source: "native-schedule",
              message: `Couldn't list native schedules: ${Cause.pretty(nativeResult.failure)}`,
            },
          ]
        : []
    const stored = yield* records(ctx)
    const storedRuns = yield* runs(ctx)
    const sessions = yield* Effect.forEach(
      native,
      (schedule) =>
        schedule.sessionID === undefined
          ? Effect.succeed([schedule.id, undefined] as const)
          : ctx.session
              .get({ sessionID: schedule.sessionID })
              .pipe(
                Effect.option,
                Effect.catchCause(() => Effect.succeed(Option.none<Session.Info>())),
              )
              .pipe(Effect.map((session) => [schedule.id, Option.getOrUndefined(session)] as const)),
      { concurrency: "unbounded" },
    ).pipe(Effect.map((entries) => new Map(entries)))
    return assemble({
      records: stored.records,
      runs: storedRuns.runs,
      schedules: native,
      sessions,
      warnings: [...nativeWarnings, ...stored.warnings, ...storedRuns.warnings],
      observedAt,
    })
  })
}

export function assemble(input: {
  readonly records: readonly KiloFlowRpc.Record[]
  readonly runs?: readonly KiloFlowRpc.Run[]
  readonly schedules: readonly Schedule.Info[]
  readonly sessions: ReadonlyMap<Schedule.ID, Session.Info | undefined>
  readonly warnings: readonly KiloFlowRpc.Warning[]
  readonly observedAt: number
}): KiloFlowRpc.ListOutput {
  const native = new Map(input.schedules.map((schedule) => [schedule.id, schedule]))
  const managedSchedules = new Set(input.records.flatMap((record) => (record.scheduleID ? [record.scheduleID] : [])))
  const latest = new Map<KiloFlowRpc.ID, KiloFlowRpc.Run>()
  input.runs?.forEach((run) => {
    const previous = latest.get(run.flowID)
    if (
      !previous ||
      previous.time.created < run.time.created ||
      (previous.time.created === run.time.created && previous.id < run.id)
    )
      latest.set(run.flowID, run)
  })
  return {
    flows: [
      ...input.records.map((record) =>
        managed(record, record.scheduleID ? native.get(record.scheduleID) : undefined, latest.get(record.id)),
      ),
      ...input.schedules
        .filter((schedule) => !managedSchedules.has(schedule.id))
        .map((schedule) => unmanaged(schedule, input.sessions.get(schedule.id))),
    ],
    warnings: [...input.warnings],
    observedAt: input.observedAt,
  }
}

function managed(
  record: KiloFlowRpc.Record,
  schedule: Schedule.Info | undefined,
  run?: KiloFlowRpc.Run,
): KiloFlowRpc.Info {
  const reference = {
    type: "managed" as const,
    flowID: record.id,
    ...(record.scheduleID ? { scheduleID: record.scheduleID } : {}),
  }
  if (!record.scheduleID)
    return {
      reference,
      name: record.name,
      authority: record.authority,
      trigger: record.trigger,
      execution: record.execution,
      context: record.context,
      prompt: record.prompt,
      permissions: record.permissions ?? [],
      status: "paused",
      ...(run ? { lastRunAt: run.time.started ?? run.time.created } : {}),
      ...(run && outcome(run) ? { lastOutcome: outcome(run) } : {}),
      ...(run ? { latestRun: run } : {}),
      health: { status: "healthy" },
      time: record.time,
    }
  if (!schedule)
    return {
      reference,
      name: record.name,
      authority: record.authority,
      trigger: record.trigger,
      execution: record.execution,
      context: record.context,
      prompt: record.prompt,
      permissions: record.permissions ?? [],
      status: "error",
      health: { status: "error", message: `Backing schedule ${record.scheduleID} no longer exists` },
      time: record.time,
    }
  return {
    reference,
    name: record.name,
    authority: record.authority,
    trigger: record.trigger,
    execution: record.execution,
    context: record.context,
    prompt: record.prompt,
    permissions: record.permissions ?? [],
    status: status(schedule.status),
    nextRunAt: instant(schedule.nextDueAt),
    lastRunAt: run?.time.started ?? run?.time.created ?? instant(schedule.lastFiredAt),
    lastOutcome: (run && outcome(run)) ?? schedule.lastOutcome,
    ...(run ? { latestRun: run } : {}),
    health: { status: "healthy" },
    time: record.time,
  }
}

function outcome(run: KiloFlowRpc.Run): KiloFlowRpc.Outcome | undefined {
  if (run.status === "succeeded" || run.status === "failed" || run.status === "interrupted" || run.status === "skipped")
    return run.status
  return undefined
}

function scheduledPrompt(flowID: KiloFlowRpc.ID) {
  return `${scheduledPromptPrefix}${flowID}]`
}

function scheduledFlowID(schedule: Schedule.Info) {
  if (schedule.action.type !== "prompt") return
  if (!schedule.action.prompt.startsWith(scheduledPromptPrefix) || !schedule.action.prompt.endsWith("]")) return
  return Option.getOrUndefined(
    decodeFlowID(schedule.action.prompt.slice(scheduledPromptPrefix.length, schedule.action.prompt.length - 1)),
  )
}

function time(input: KiloFlowRpc.CreateInput["when"]): Schedule.When {
  if (input.in !== undefined) return { type: "in", in: input.in, tz: input.tz }
  if (input.at !== undefined) return { type: "at", at: input.at, tz: input.tz }
  if (input.every !== undefined) return { type: "every", every: input.every, tz: input.tz }
  return { type: "cron", cron: input.cron, tz: input.tz }
}

function unmanaged(schedule: Schedule.Info, session: Session.Info | undefined): KiloFlowRpc.Info {
  const missing =
    schedule.sessionID === undefined
      ? "Native schedule has no Session"
      : `Session ${schedule.sessionID} no longer exists`
  return {
    reference: { type: "native-schedule", scheduleID: schedule.id },
    name: schedule.name ?? "Scheduled prompt",
    authority: { type: "local" },
    trigger: trigger(schedule),
    execution: {
      type: "local",
      mode: "session-reuse",
      sessionID: schedule.sessionID,
    },
    context: {
      directory: session?.location.directory,
      projectID: session?.projectID,
      sessionID: schedule.sessionID,
      model: session?.model,
      agent: session?.agent,
    },
    prompt: schedule.action.prompt,
    status: session ? status(schedule.status) : "error",
    nextRunAt: instant(schedule.nextDueAt),
    lastRunAt: instant(schedule.lastFiredAt),
    lastOutcome: schedule.lastOutcome,
    health: session ? { status: "healthy" } : { status: "error", message: missing },
    time: { created: instant(schedule.time.created), updated: instant(schedule.time.updated) },
  }
}

function trigger(schedule: Schedule.Info): KiloFlowRpc.Trigger {
  if (schedule.if)
    return { type: "poll", when: schedule.when, timezone: schedule.tz, mode: "if", condition: schedule.if }
  if (schedule.until)
    return { type: "poll", when: schedule.when, timezone: schedule.tz, mode: "until", condition: schedule.until }
  return { type: "time", when: schedule.when, timezone: schedule.tz }
}

function status(value: Schedule.Status): KiloFlowRpc.Status {
  if (value === "done") return "completed"
  return value
}

function instant(value: DateTime.Utc): number
function instant(value: DateTime.Utc | undefined): number | undefined
function instant(value: DateTime.Utc | undefined) {
  return value && DateTime.toEpochMillis(value)
}

function records(ctx: Plugin.Context) {
  return Effect.gen(function* () {
    const found: KiloFlowRpc.Record[] = []
    const warnings: KiloFlowRpc.Warning[] = []
    let after: string | undefined
    do {
      const page = yield* ctx.storage.scan({ prefix, after }).pipe(Effect.result)
      if (page._tag === "Failure") {
        warnings.push({
          source: "managed",
          message: `Couldn't read managed Flow records: ${Cause.pretty(page.failure)}`,
        })
        break
      }
      page.success.entries.forEach((entry) => {
        const decoded = storedRecord(entry.key, entry.value)
        if (decoded.record) found.push(decoded.record)
        if (decoded.warning) warnings.push(decoded.warning)
      })
      after = page.success.next
    } while (after !== undefined)
    return { records: found, warnings }
  })
}

function runs(ctx: Plugin.Context) {
  return Effect.gen(function* () {
    const found: KiloFlowRpc.Run[] = []
    const warnings: KiloFlowRpc.Warning[] = []
    let after: string | undefined
    do {
      const page = yield* ctx.storage.scan({ prefix: runPrefix, after }).pipe(Effect.result)
      if (page._tag === "Failure") {
        warnings.push({
          source: "managed-run",
          message: `Couldn't read Flow run records: ${Cause.pretty(page.failure)}`,
        })
        break
      }
      page.success.entries.forEach((entry) => {
        const decoded = Option.getOrUndefined(decodeRun(entry.value))
        if (decoded && entry.key === runKey(decoded)) found.push(decoded)
        else
          warnings.push({
            source: "managed-run",
            reference: entry.key,
            message: "Stored Flow run record is malformed or stale",
          })
      })
      after = page.success.next
    } while (after !== undefined)
    return { runs: found, warnings }
  })
}

function complete(
  ctx: Plugin.Context,
  event: SessionEvent.Execution.Succeeded | SessionEvent.Execution.Failed | SessionEvent.Execution.Interrupted,
  background: ReadonlySet<Session.ID>,
) {
  if (event.type === "session.execution.interrupted" && event.data.reason === "shutdown") return Effect.void
  if (event.type === "session.execution.succeeded" && background.has(event.data.sessionID)) return Effect.void
  return Effect.gen(function* () {
    const session = yield* ctx.session.get({ sessionID: event.data.sessionID })
    const metadata = Option.getOrUndefined(decodeMetadata(session.metadata?.[metadataKey]))
    if (!metadata) return
    const key = `${runPrefix}${metadata.flowID}:${metadata.runID}`
    const stored = Option.getOrUndefined(decodeRun(yield* ctx.storage.get(key)))
    if (!stored || stored.sessionID !== session.id) return
    if (stored.status !== "starting" && stored.status !== "running") return
    const completed = event.created
    const status =
      event.type === "session.execution.succeeded"
        ? "succeeded"
        : event.type === "session.execution.failed"
          ? "failed"
          : "interrupted"
    const updated: KiloFlowRpc.Run = {
      ...stored,
      status,
      ...(event.type === "session.execution.failed" ? { error: event.data.error.message } : {}),
      time: { ...stored.time, updated: completed, completed },
    }
    yield* ctx.storage.set(key, JSON.stringify(updated))
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("failed to update Flow run outcome", { sessionID: event.data.sessionID, cause }),
    ),
  )
}

function permissionFailed(ctx: Plugin.Context, sessionID: Session.ID, tool: string, message: string) {
  return Effect.gen(function* () {
    const session = yield* ctx.session.get({ sessionID })
    const metadata = Option.getOrUndefined(decodeMetadata(session.metadata?.[metadataKey]))
    if (!metadata) return
    const key = `${runPrefix}${metadata.flowID}:${metadata.runID}`
    const stored = Option.getOrUndefined(decodeRun(yield* ctx.storage.get(key)))
    if (!stored || stored.sessionID !== session.id) return
    if (stored.status !== "starting" && stored.status !== "running") return
    const completed = Date.now()
    yield* ctx.storage.set(
      key,
      JSON.stringify({
        ...stored,
        status: "failed",
        error: `Flow permission policy blocked ${tool}: ${message}`,
        time: { ...stored.time, updated: completed, completed },
      } satisfies KiloFlowRpc.Run),
    )
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("failed to record Flow permission error", { sessionID, tool, cause }),
    ),
  )
}

function runKey(run: Pick<KiloFlowRpc.Run, "flowID" | "id">) {
  return `${runPrefix}${run.flowID}:${run.id}`
}

function permissionSummary(permissions: readonly KiloFlowRpc.PermissionGrant[]) {
  if (permissions.length === 0) return "no unattended permissions"
  return `unattended permissions ${permissions.map((permission) => `${permission.action}: ${permission.resource}`).join(", ")}`
}

export function permissionInstructions(permissions: readonly KiloFlowRpc.PermissionGrant[]) {
  const allowed =
    permissions.length === 0
      ? ["- No tool permissions are approved."]
      : permissions.map((permission) => `- ${permission.action}: ${permission.resource}`)
  return [
    "You are running an unattended Flow. No user is present to approve additional permissions.",
    "Approved permission patterns:",
    ...allowed,
    "Permission resources are wildcard patterns matched against actual tool requests. Choose tool inputs that match these patterns exactly.",
    "For shell calls, every parsed command in a compound command must match an approved shell pattern. Prefer dedicated read, edit, or write tools over shell redirection when their actions are approved.",
    "Do not make exploratory or preflight tool calls outside the allowlist, and do not work around or repeatedly retry a denied operation. If the allowlist cannot complete the task, report the missing action and resource.",
  ].join("\n")
}

export function storedRecord(
  key: string,
  value: Schema.Json,
): {
  readonly record?: KiloFlowRpc.Record
  readonly warning?: KiloFlowRpc.Warning
} {
  const decoded = Option.getOrUndefined(decodeRecord(value))
  if (decoded && key === `${prefix}${decoded.id}`) return { record: decoded }
  return { warning: { source: "managed", reference: key, message: "Stored Flow record is malformed or stale" } }
}
