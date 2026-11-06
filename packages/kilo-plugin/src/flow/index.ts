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
import { Cause, DateTime, Effect, Option, Schema, Semaphore, Stream } from "effect"
import {
  flowPermissions,
  permissionInstructions,
  permissionSummary,
  validatePermissions,
} from "./permissions"

export { flowPermissions, permissionInstructions } from "./permissions"

const prefix = "flow:v1:"
const runPrefix = "flow-run:v1:"
const activePrefix = "flow-active:v1:"
const schedulePrefix = "flow-schedule:v1:"
const metadataKey = "kilocode.flow"
const permissionAction = "flow"
const retainedRuns = 20
const decodeRecord = Schema.decodeUnknownOption(
  Schema.Union([KiloFlowRpc.Record, Schema.fromJsonString(KiloFlowRpc.Record)]),
)
const decodeRun = Schema.decodeUnknownOption(Schema.Union([KiloFlowRpc.Run, Schema.fromJsonString(KiloFlowRpc.Run)]))
const decodeFlowID = Schema.decodeUnknownOption(KiloFlowRpc.ID)
const decodeRunID = Schema.decodeUnknownOption(KiloFlowRpc.RunID)
const decodeMetadata = Schema.decodeUnknownOption(Schema.Struct({ flowID: KiloFlowRpc.ID, runID: KiloFlowRpc.RunID }))
const decodeBlockedPermission = Schema.decodeUnknownOption(
  Schema.Struct({
    _tag: Schema.Literal("Permission.BlockedError"),
    permission: Schema.String,
    resources: Schema.Array(Schema.String),
  }),
)

type Runtime = {
  readonly fs: FSUtil.Interface
  readonly locks: Map<KiloFlowRpc.ID, Semaphore.Semaphore>
}

export const KiloFlowPlugin = define({
  id: "kilocode.flow",
  effect: Effect.fn(function* (ctx) {
    const schedules = yield* Schedule.Service
    const runtime = { fs: yield* FSUtil.Service, locks: new Map() } satisfies Runtime
    const selections = new Map<Session.ID, { readonly model: Model.Ref; readonly agent: Agent.ID }>()
    const background = new Set<Session.ID>()
    yield* reconcileActive(ctx, runtime).pipe(
      Effect.catchCause((cause) => Effect.logWarning("failed to reconcile active Flow runs", { cause })),
    )
    yield* ctx.session.hook("experimental.schedule", (event) =>
      Effect.gen(function* () {
        const flowID = Option.getOrUndefined(decodeFlowID(yield* ctx.storage.get(scheduleKey(event.schedule.id))))
        if (flowID === undefined) return
        event.claimed = true
        yield* scheduled(ctx, event.schedule, flowID, runtime)
      }),
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
            Object.keys(event.tools),
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
      if (event.status !== "error") return Effect.void
      const blocked = Option.getOrUndefined(decodeBlockedPermission(event.error.error))
      if (!blocked) return Effect.void
      return permissionFailed(ctx, runtime, event.sessionID, event.tool, blocked.permission, blocked.resources)
    })
    yield* ctx.event
      .subscribe({
        types: ["session.execution.succeeded", "session.execution.failed", "session.execution.interrupted"],
      })
      .pipe(
        Stream.runForEach((event) => {
          selections.delete(event.data.sessionID)
          return complete(ctx, runtime, event, background)
        }),
        Effect.forkScoped({ startImmediately: true }),
      )
    yield* ctx.rpc
      .register(KiloFlowRpc.Definition, {
        list: () => list(ctx, schedules, ctx.location.project.id),
        create: (input, context) =>
          create(ctx, schedules, input, ctx.location.project.id).pipe(
            Effect.mapError((error) => context.error("failed", error.message)),
          ),
        run: (input, context) =>
          run(ctx, input, ctx.location.project.id, runtime).pipe(
            Effect.mapError((error) => context.error("failed", error.message)),
          ),
        pause: (input, context) =>
          control(ctx, schedules, input, ctx.location.project.id, "pause").pipe(
            Effect.mapError((error) => context.error("failed", error.message)),
          ),
        resume: (input, context) =>
          control(ctx, schedules, input, ctx.location.project.id, "resume").pipe(
            Effect.mapError((error) => context.error("failed", error.message)),
          ),
        remove: (input, context) =>
          remove(ctx, schedules, input, ctx.location.project.id, runtime).pipe(
            Effect.as({}),
            Effect.mapError((error) => context.error("failed", error.message)),
          ),
      })
      .pipe(Effect.orDie)
    yield* ctx.tool
      .transform((editor) => {
        editor.add({
          name: "flow_create",
          description:
            "Create a scheduled managed local Flow from this Session. Every new Flow receives repository-local read, glob, and grep access. Before calling, identify every additional unattended permission action and its narrowest stable resource pattern. Shell resources match parsed command text, such as `taskctl *`; never use a filesystem directory as a shell resource. File actions use paths or patterns, such as `edit: reports/*`. webfetch uses URL patterns, websearch uses query patterns, and MCP tools currently require resource `*` because their permission requests are capability-wide. Paths outside the Flow directory also require external_directory with a bounded directory wildcard such as `/home/user/*`, separately from any shell command permission needed to operate there. The user reviews the exact baseline plus additional patterns before the Flow is stored, and the executor receives the available tools and same allowlist as constraints. Use an empty list when the baseline is sufficient. The Flow appears in /periodic, runs automatically on its schedule, and can also be started manually with flow_run.",
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
                content: `Created scheduled Flow ${flow.name} with ${permissionSummary(flow.permissions ?? [])}. Start an extra run manually with flow_run using Flow ID ${flow.reference.type === "managed" ? flow.reference.flowID : "unknown"}.`,
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
              Effect.flatMap((session) => run(ctx, input, session.projectID, runtime)),
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
    const invalidPermission = validatePermissions(input.permissions)
    if (invalidPermission) return yield* Effect.fail(new Error(invalidPermission))
    const now = Date.now()
    const permissions = flowPermissions(input.permissions)
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
      permissions,
      time: { created: now, updated: now },
    }
    yield* ctx.permission.assert({
      action: permissionAction,
      resources:
        permissions.map((permission) => `${permission.action}: ${permission.resource}`),
      sessionID: session.id,
      agent,
      metadata: {
        [metadataKey]: {
          flowID: record.id,
          name: record.name,
          permissions,
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
          action: { type: "hook", prompt: "" },
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
    yield* ctx.storage.set(scheduleKey(schedule.id), configured.id).pipe(
      Effect.mapError(() => new Error(`Couldn't index backing schedule for Flow ${record.id}`)),
      Effect.onError(() =>
        schedules.remove(schedule.id).pipe(
          Effect.ignore,
          Effect.andThen(ctx.storage.remove(key).pipe(Effect.ignore)),
          Effect.andThen(ctx.storage.remove(scheduleKey(schedule.id)).pipe(Effect.ignore)),
        ),
      ),
    )
    return managed(configured, schedule)
  })
}

export function run(
  ctx: Plugin.Context,
  input: KiloFlowRpc.RunInput,
  authorizedProjectID: Session.Info["projectID"],
  runtime: Runtime,
): Effect.Effect<KiloFlowRpc.Run, Error> {
  return Effect.gen(function* () {
    const value = yield* ctx.storage.get(`${prefix}${input.flowID}`)
    const record = Option.getOrUndefined(decodeRecord(value))
    if (!record || record.id !== input.flowID || record.context.projectID !== authorizedProjectID)
      return yield* Effect.fail(new Error(`Flow ${input.flowID} does not exist`))
    return yield* start(ctx, record, KiloFlowRpc.RunID.create(), runtime)
  })
}

function control(
  ctx: Plugin.Context,
  schedules: Pick<Schedule.Interface, "pause" | "resume">,
  input: KiloFlowRpc.ControlInput,
  authorizedProjectID: Session.Info["projectID"],
  operation: "pause" | "resume",
) {
  return Effect.gen(function* () {
    const record = yield* requireRecord(ctx, input.flowID, authorizedProjectID)
    if (!record.scheduleID) return yield* Effect.fail(new Error(`Flow ${record.id} has no backing schedule`))
    const schedule = yield* (operation === "pause"
      ? schedules.pause(record.scheduleID)
      : schedules.resume(record.scheduleID)
    ).pipe(Effect.mapError((error) => new Error(error.message)))
    const storedRuns = yield* runs(ctx, [record.id])
    return managed(record, schedule, latestRun(storedRuns.runs, record.id))
  })
}

function remove(
  ctx: Plugin.Context,
  schedules: Pick<Schedule.Interface, "remove">,
  input: KiloFlowRpc.ControlInput,
  authorizedProjectID: Session.Info["projectID"],
  runtime: Runtime,
) {
  return Effect.gen(function* () {
    const record = yield* requireRecord(ctx, input.flowID, authorizedProjectID)
    const lock = flowLock(runtime, record.id)
    yield* lock.withPermit(
      Effect.gen(function* () {
        const active = yield* reconcileFlowActive(ctx, record.id)
        if (active?.sessionID) yield* ctx.session.interrupt({ sessionID: active.sessionID }).pipe(Effect.ignore)
        if (record.scheduleID)
          yield* schedules.remove(record.scheduleID).pipe(
            Effect.catchTag("Schedule.NotFoundError", () => Effect.void),
          )
        yield* removeRuns(ctx, record.id)
        yield* Effect.all(
          [
            ctx.storage.remove(`${prefix}${record.id}`),
            ctx.storage.remove(activeKey(record.id)),
            ...(record.scheduleID ? [ctx.storage.remove(scheduleKey(record.scheduleID))] : []),
          ],
          { discard: true },
        )
      }),
    )
    if (runtime.locks.get(record.id) === lock) runtime.locks.delete(record.id)
  })
}

function requireRecord(
  ctx: Plugin.Context,
  flowID: KiloFlowRpc.ID,
  authorizedProjectID: Session.Info["projectID"],
) {
  return Effect.gen(function* () {
    const record = Option.getOrUndefined(decodeRecord(yield* ctx.storage.get(`${prefix}${flowID}`)))
    if (!record || record.id !== flowID || record.context.projectID !== authorizedProjectID)
      return yield* Effect.fail(new Error(`Flow ${flowID} does not exist`))
    return record
  })
}

export function scheduled(
  ctx: Plugin.Context,
  schedule: Schedule.Info,
  flowID: KiloFlowRpc.ID,
  runtime: Runtime,
): Effect.Effect<"fired" | "skipped" | "failed"> {
  return Effect.gen(function* () {
    const record = Option.getOrUndefined(decodeRecord(yield* ctx.storage.get(`${prefix}${flowID}`)))
    if (!record || record.id !== flowID || (record.scheduleID !== undefined && record.scheduleID !== schedule.id))
      return yield* Effect.fail(new Error(`Backing schedule ${schedule.id} has no matching Flow ${flowID}`))
    if (schedule.nextDueAt === undefined)
      return yield* Effect.fail(new Error(`Backing schedule ${schedule.id} has no due time`))
    const dueAt = DateTime.toEpochMillis(schedule.nextDueAt)
    const execution = yield* start(
      ctx,
      record,
      KiloFlowRpc.RunID.make(`flr_${record.id.slice(4)}_${dueAt}`),
      runtime,
      { scheduleID: schedule.id, dueAt },
    )
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
  runtime: Runtime,
  scheduled?: KiloFlowRpc.ScheduledOccurrence,
): Effect.Effect<KiloFlowRpc.Run, Error> {
  return flowLock(runtime, record.id).withPermit(
    Effect.gen(function* () {
      const directory = record.context.directory
      const projectID = record.context.projectID
      const model = record.context.model
      const agent = record.context.agent
      if (!directory || !projectID || !model || !agent)
        return yield* Effect.fail(new Error(`Flow ${record.id} is missing execution context`))
      const invalidPermission = validatePermissions(record.permissions ?? [])
      if (invalidPermission) return yield* Effect.fail(new Error(`Flow ${record.id} has invalid permissions: ${invalidPermission}`))

      const key = runKey({ flowID: record.id, id: runID })
      const existing = Option.getOrUndefined(decodeRun(yield* ctx.storage.get(key)))
      if (existing?.flowID === record.id && existing.id === runID) return existing

      const now = Date.now()
      if (yield* reconcileFlowActive(ctx, record.id)) {
        const skipped: KiloFlowRpc.Run = {
          version: 1,
          id: runID,
          flowID: record.id,
          status: "skipped",
          worktree: record.execution.worktree,
          ...(scheduled ? { scheduled } : {}),
          time: { created: now, updated: now, completed: now },
        }
        yield* persistRun(ctx, skipped)
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
      yield* persistRun(ctx, initial)
      yield* ctx.storage.set(activeKey(record.id), initial.id)

      const canonicalDirectory = AbsolutePath.make(yield* runtime.fs.resolve(directory))
      const targetResult = yield* (
        record.execution.worktree === "new"
          ? Effect.gen(function* () {
              const sources = yield* Effect.forEach(yield* ctx.worktree.list({ projectID }), (worktree) =>
                runtime.fs
                  .resolve(worktree.directory)
                  .pipe(Effect.map((canonical) => ({ worktree, canonical: AbsolutePath.make(canonical) }))),
              )
              const source = sources
                .filter((candidate) => FSUtil.contains(candidate.canonical, canonicalDirectory))
                .toSorted((left, right) => right.canonical.length - left.canonical.length)[0]
              if (!source)
                return yield* Effect.fail(new Error(`Flow directory ${directory} has no containing worktree`))
              const worktree = yield* ctx.worktree.create({
                projectID,
                from: source.worktree.directory,
                name: `${record.id}-${initial.id}`,
              })
              return AbsolutePath.make(
                yield* runtime.fs.resolve(
                  path.resolve(worktree.directory, path.relative(source.canonical, canonicalDirectory)),
                ),
              )
            })
          : Effect.succeed(canonicalDirectory)
      ).pipe(
        Effect.onInterrupt(() => failRun(ctx, initial, new Error("Flow start was interrupted")).pipe(Effect.asVoid)),
        Effect.result,
      )
      if (targetResult._tag === "Failure") return yield* failRun(ctx, initial, targetResult.failure)

      const admitting: KiloFlowRpc.Run = {
        ...initial,
        sessionID: Session.ID.make(`ses_flow_${initial.id.slice(4)}`),
        directory: targetResult.success,
        time: { ...initial.time, updated: Date.now() },
      }
      yield* persistRun(ctx, admitting)
      const sessionResult = yield* ctx.session
        .create({
          id: admitting.sessionID,
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
          Effect.onInterrupt(() => failRun(ctx, admitting, new Error("Flow start was interrupted")).pipe(Effect.asVoid)),
          Effect.result,
        )
      if (sessionResult._tag === "Failure") return yield* failRun(ctx, admitting, sessionResult.failure)

      const started = Date.now()
      const running: KiloFlowRpc.Run = {
        ...admitting,
        status: "running",
        time: { ...admitting.time, updated: started, started },
      }
      yield* persistRun(ctx, running)
      const prompted = yield* ctx.session.prompt({ sessionID: sessionResult.success.id, text: record.prompt }).pipe(
        Effect.onInterrupt(() => failRun(ctx, running, new Error("Flow start was interrupted")).pipe(Effect.asVoid)),
        Effect.result,
      )
      if (prompted._tag === "Failure") return yield* failRun(ctx, running, prompted.failure)
      return running
    }),
  )
}

function failRun(ctx: Plugin.Context, run: KiloFlowRpc.Run, error: unknown) {
  const completed = Date.now()
  const failed: KiloFlowRpc.Run = {
    ...run,
    status: "failed",
    error: Cause.pretty(Cause.fail(error)),
    time: { ...run.time, updated: completed, completed },
  }
  return persistRun(ctx, failed).pipe(
    Effect.andThen(clearActive(ctx, failed)),
    Effect.as(failed),
  )
}

export function list(
  ctx: Plugin.Context,
  schedules: Pick<Schedule.Interface, "list">,
  projectID: Session.Info["projectID"],
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
    const scopedRecords = stored.records.filter((record) => record.context.projectID === projectID)
    const storedRuns = yield* runs(
      ctx,
      scopedRecords.map((record) => record.id),
    )
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
    const managedScheduleIDs = new Set(
      stored.records.flatMap((record) => (record.scheduleID ? [record.scheduleID] : [])),
    )
    const scopedManagedScheduleIDs = new Set(
      scopedRecords.flatMap((record) => (record.scheduleID ? [record.scheduleID] : [])),
    )
    const scopedSchedules = native.filter(
      (schedule) =>
        scopedManagedScheduleIDs.has(schedule.id) ||
        (!managedScheduleIDs.has(schedule.id) && sessions.get(schedule.id)?.projectID === projectID),
    )
    return assemble({
      records: scopedRecords,
      runs: storedRuns.runs,
      schedules: scopedSchedules,
      sessions,
      warnings: [...nativeWarnings, ...storedRuns.warnings],
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
  const latest = new Map(
    input.records.flatMap((record) => {
      const run = latestRun(input.runs ?? [], record.id)
      return run ? [[record.id, run] as const] : []
    }),
  )
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

function runs(ctx: Plugin.Context, flowIDs: readonly KiloFlowRpc.ID[]) {
  return Effect.gen(function* () {
    const found: KiloFlowRpc.Run[] = []
    const warnings: KiloFlowRpc.Warning[] = []
    yield* Effect.forEach(
      flowIDs,
      (flowID) =>
        Effect.gen(function* () {
          let after: string | undefined
          do {
            const page = yield* ctx.storage.scan({ prefix: `${runPrefix}${flowID}:`, after }).pipe(Effect.result)
            if (page._tag === "Failure") {
              warnings.push({
                source: "managed-run",
                reference: flowID,
                message: `Couldn't read Flow run records: ${Cause.pretty(page.failure)}`,
              })
              break
            }
            page.success.entries.forEach((entry) => {
              const decoded = Option.getOrUndefined(decodeRun(entry.value))
              if (decoded && decoded.flowID === flowID && entry.key === runKey(decoded)) found.push(decoded)
              else
                warnings.push({
                  source: "managed-run",
                  reference: entry.key,
                  message: "Stored Flow run record is malformed or stale",
                })
            })
            after = page.success.next
          } while (after !== undefined)
        }),
      { discard: true },
    )
    return { runs: found, warnings }
  })
}

function latestRun(runs: readonly KiloFlowRpc.Run[], flowID: KiloFlowRpc.ID) {
  return runs
    .filter((run) => run.flowID === flowID && run.status !== "skipped")
    .toSorted(
      (left, right) =>
        right.time.created - left.time.created || right.id.localeCompare(left.id),
    )[0]
}

function pruneRuns(ctx: Plugin.Context, flowID: KiloFlowRpc.ID) {
  return Effect.gen(function* () {
    const stored = yield* runs(ctx, [flowID])
    const active = Option.getOrUndefined(decodeRunID(yield* ctx.storage.get(activeKey(flowID))))
    const keep = new Set<KiloFlowRpc.RunID>(active ? [active] : [])
    stored.runs
      .toSorted((left, right) => right.time.created - left.time.created || right.id.localeCompare(left.id))
      .forEach((run) => {
        if (keep.size < retainedRuns) keep.add(run.id)
      })
    const stale = stored.runs.filter((run) => !keep.has(run.id))
    yield* Effect.forEach(stale, (run) => ctx.storage.remove(runKey(run)), { discard: true })
  })
}

function removeRuns(ctx: Plugin.Context, flowID: KiloFlowRpc.ID) {
  return Effect.gen(function* () {
    let after: string | undefined
    do {
      const page = yield* ctx.storage.scan({ prefix: `${runPrefix}${flowID}:`, after })
      yield* Effect.forEach(page.entries, (entry) => ctx.storage.remove(entry.key), { discard: true })
      after = page.next
    } while (after !== undefined)
  })
}

function persistRun(ctx: Plugin.Context, run: KiloFlowRpc.Run) {
  return ctx.storage
    .set(runKey(run), JSON.stringify(run))
    .pipe(Effect.andThen(pruneRuns(ctx, run.flowID)))
}

function reconcileActive(ctx: Plugin.Context, runtime: Runtime) {
  return Effect.gen(function* () {
    const stored = yield* records(ctx)
    yield* Effect.forEach(
      stored.records,
      (record) =>
        Effect.gen(function* () {
          if (record.scheduleID) yield* ctx.storage.set(scheduleKey(record.scheduleID), record.id)
          yield* flowLock(runtime, record.id).withPermit(
            Effect.gen(function* () {
              const current = yield* reconcileFlowActive(ctx, record.id)
              const stored = yield* runs(ctx, [record.id])
              const running = stored.runs
                .filter((run) => run.status === "running")
                .toSorted((left, right) => right.time.updated - left.time.updated)[0]
              const adopted = current ?? running
              if (!current && adopted) yield* ctx.storage.set(activeKey(record.id), adopted.id)
              yield* Effect.forEach(
                stored.runs.filter(
                  (run) =>
                    (run.status === "starting" || run.status === "running") && run.id !== adopted?.id,
                ),
                (run) => failRun(ctx, run, new Error("Flow start was abandoned before prompt admission")),
                { discard: true },
              )
            }),
          )
        }),
      { discard: true },
    )
  })
}

function reconcileFlowActive(ctx: Plugin.Context, flowID: KiloFlowRpc.ID) {
  return Effect.gen(function* () {
    const runID = Option.getOrUndefined(decodeRunID(yield* ctx.storage.get(activeKey(flowID))))
    if (!runID) {
      yield* ctx.storage.remove(activeKey(flowID))
      return
    }
    const run = Option.getOrUndefined(decodeRun(yield* ctx.storage.get(runKey({ flowID, id: runID }))))
    if (!run || run.flowID !== flowID || run.id !== runID) {
      yield* ctx.storage.remove(activeKey(flowID))
      return
    }
    if (run.status === "running") return run
    if (run.status === "starting") {
      yield* failRun(ctx, run, new Error("Flow start was abandoned before prompt admission"))
      return
    }
    yield* ctx.storage.remove(activeKey(flowID))
  })
}

function clearActive(ctx: Plugin.Context, run: Pick<KiloFlowRpc.Run, "flowID" | "id">) {
  return Effect.gen(function* () {
    const active = Option.getOrUndefined(decodeRunID(yield* ctx.storage.get(activeKey(run.flowID))))
    if (active === run.id) yield* ctx.storage.remove(activeKey(run.flowID))
  })
}

function flowLock(runtime: Runtime, flowID: KiloFlowRpc.ID) {
  const current = runtime.locks.get(flowID)
  if (current) return current
  const lock = Semaphore.makeUnsafe(1)
  runtime.locks.set(flowID, lock)
  return lock
}

function activeKey(flowID: KiloFlowRpc.ID) {
  return `${activePrefix}${flowID}`
}

function scheduleKey(scheduleID: Schedule.ID) {
  return `${schedulePrefix}${scheduleID}`
}

function complete(
  ctx: Plugin.Context,
  runtime: Runtime,
  event: SessionEvent.Execution.Succeeded | SessionEvent.Execution.Failed | SessionEvent.Execution.Interrupted,
  background: ReadonlySet<Session.ID>,
) {
  if (event.type === "session.execution.interrupted" && event.data.reason === "shutdown") return Effect.void
  if (event.type === "session.execution.succeeded" && background.has(event.data.sessionID)) return Effect.void
  return Effect.gen(function* () {
    const session = yield* ctx.session.get({ sessionID: event.data.sessionID })
    yield* withStoredRun(ctx, runtime, session, (stored) =>
      Effect.gen(function* () {
        const completed = event.created
        const status = stored.error
          ? "failed"
          : event.type === "session.execution.succeeded"
            ? "succeeded"
            : event.type === "session.execution.failed"
              ? "failed"
              : "interrupted"
        const updated: KiloFlowRpc.Run = {
          ...stored,
          status,
          ...(event.type === "session.execution.failed" && !stored.error ? { error: event.data.error.message } : {}),
          time: { ...stored.time, updated: completed, completed },
        }
        yield* persistRun(ctx, updated)
        yield* clearActive(ctx, updated)
      }),
    )
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("failed to update Flow run outcome", { sessionID: event.data.sessionID, cause }),
    ),
  )
}

function permissionFailed(
  ctx: Plugin.Context,
  runtime: Runtime,
  sessionID: Session.ID,
  tool: string,
  permission: string,
  resources: readonly string[],
) {
  return Effect.gen(function* () {
    const session = yield* ctx.session.get({ sessionID })
    yield* withStoredRun(ctx, runtime, session, (stored) =>
      persistRun(ctx, {
        ...stored,
        error: `Flow permission policy blocked ${permission} for ${resources.map((resource) => JSON.stringify(resource)).join(", ")} while running ${tool}`,
        time: { ...stored.time, updated: Date.now() },
      }),
    )
    yield* ctx.session.interrupt({ sessionID }).pipe(Effect.ignore)
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("failed to record Flow permission error", { sessionID, tool, cause }),
    ),
  )
}

function withStoredRun(
  ctx: Plugin.Context,
  runtime: Runtime,
  session: Session.Info,
  update: (run: KiloFlowRpc.Run) => Effect.Effect<void>,
) {
  return Effect.gen(function* () {
    const metadata = Option.getOrUndefined(decodeMetadata(session.metadata?.[metadataKey]))
    if (!metadata) return
    yield* flowLock(runtime, metadata.flowID).withPermit(
      Effect.gen(function* () {
        const stored = Option.getOrUndefined(
          decodeRun(yield* ctx.storage.get(runKey({ flowID: metadata.flowID, id: metadata.runID }))),
        )
        if (!stored || stored.sessionID !== session.id) return
        if (stored.status !== "starting" && stored.status !== "running") return
        yield* update(stored)
      }),
    )
  })
}

function runKey(run: Pick<KiloFlowRpc.Run, "flowID" | "id">) {
  return `${runPrefix}${run.flowID}:${run.id}`
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
