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
import { Cause, DateTime, Effect, Option, Ref, Schema, Semaphore, Stream } from "effect"
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
const latestPrefix = "flow-latest:v1:"
const metadataKey = KiloFlowRpc.sessionMetadata
const permissionAction = "flow"
const lookups = 8
const decodeRecord = Schema.decodeUnknownOption(
  Schema.Union([KiloFlowRpc.Record, Schema.fromJsonString(KiloFlowRpc.Record)]),
)
const decodeRun = Schema.decodeUnknownOption(Schema.Union([KiloFlowRpc.Run, Schema.fromJsonString(KiloFlowRpc.Run)]))
const decodeFlowID = Schema.decodeUnknownOption(KiloFlowRpc.ID)
const decodeRunID = Schema.decodeUnknownOption(KiloFlowRpc.RunID)
const decodeOwner = Schema.decodeUnknownOption(
  Schema.Union([
    Schema.Struct({ context: Schema.Struct({ projectID: Schema.String }) }),
    Schema.fromJsonString(Schema.Struct({ context: Schema.Struct({ projectID: Schema.String }) })),
  ]),
)
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
  /** Publishes the `changed` RPC event; a no-op until the RPC is registered. */
  readonly changed: (event: KiloFlowRpc.Changed) => Effect.Effect<void>
}

export const KiloFlowPlugin = define({
  id: "kilocode.flow",
  effect: Effect.fn(function* (ctx) {
    const schedules = yield* Schedule.Service
    const publish = yield* Ref.make<(event: KiloFlowRpc.Changed) => Effect.Effect<void>>(() => Effect.void)
    const runtime = {
      fs: yield* FSUtil.Service,
      locks: new Map(),
      changed: (event) => Effect.flatMap(Ref.get(publish), (emit) => emit(event)),
    } satisfies Runtime
    const selections = new Map<Session.ID, { readonly model: Model.Ref; readonly agent: Agent.ID }>()
    const background = new Set<Session.ID>()
    yield* reconcileActive(ctx, runtime).pipe(
      Effect.catchCause((cause) => Effect.logWarning("failed to reconcile active Flow runs", { cause })),
    )
    yield* ctx.session.hook("experimental.schedule", (event) =>
      Effect.gen(function* () {
        const flowID = Option.getOrUndefined(decodeFlowID(yield* ctx.storage.get(scheduleKey(event.schedule.id))))
        if (flowID === undefined) return
        // Claim only once the occurrence has started or was deliberately skipped. A start failure dies here so the
        // scheduler keeps the due time and retries with its failed-retry backoff instead of advancing the row.
        const outcome = yield* scheduled(ctx, schedules, event.schedule, flowID, runtime).pipe(Effect.orDie)
        if (outcome === "orphaned") return
        event.claimed = true
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
    const registration = yield* ctx.rpc
      .register(KiloFlowRpc.Definition, {
        list: () => list(ctx, schedules, ctx.location.project.id, runtime.fs),
        create: (input, context) =>
          create(ctx, schedules, input, ctx.location.project.id, runtime).pipe(
            Effect.mapError((error) =>
              error instanceof FlowExists
                ? context.error("exists", error.message, { flowID: error.flowID })
                : context.error("failed", error.message),
            ),
          ),
        update: (input, context) =>
          update(ctx, schedules, input, ctx.location.project.id, runtime).pipe(
            Effect.mapError((error) => context.error("failed", error.message)),
          ),
        runs: (input, context) =>
          history(ctx, input, ctx.location.project.id).pipe(
            Effect.mapError((error) => context.error("failed", error.message)),
          ),
        run: (input, context) =>
          run(ctx, input, ctx.location.project.id, runtime).pipe(
            Effect.mapError((error) => context.error("failed", error.message)),
          ),
        pause: (input, context) =>
          control(ctx, schedules, input, ctx.location.project.id, "pause", runtime).pipe(
            Effect.mapError((error) => context.error("failed", error.message)),
          ),
        resume: (input, context) =>
          control(ctx, schedules, input, ctx.location.project.id, "resume", runtime).pipe(
            Effect.mapError((error) => context.error("failed", error.message)),
          ),
        remove: (input, context) =>
          remove(ctx, schedules, input, ctx.location.project.id, runtime).pipe(
            Effect.mapError((error) => context.error("failed", error.message)),
          ),
      })
      .pipe(Effect.orDie)
    yield* Ref.set(publish, (event) => registration.events.emit("changed", event).pipe(Effect.ignore))
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
            return ctx.session.get({ sessionID: context.sessionID }).pipe(
              Effect.tap(refuseRunSession),
              Effect.flatMap((session) =>
                create(
                  ctx,
                  schedules,
                  {
                    ...input,
                    sourceSessionID: context.sessionID,
                    model: input.model ?? selection?.model,
                    agent: input.agent ?? selection?.agent ?? context.agent,
                  },
                  session.projectID,
                  runtime,
                ),
              ),
              Effect.map((flow) => ({
                output: flow,
                content: `Created scheduled Flow ${flow.name} with ${permissionSummary(flow.permissions ?? [])}. Start an extra run manually with flow_run using Flow ID ${flow.reference.type === "managed" ? flow.reference.flowID : "unknown"}.`,
              })),
              Effect.mapError(toolError),
            )
          },
        })
        editor.add({
          name: "flow_list",
          description:
            "List this project's managed local Flows with their ID, schedule, status, next run, and latest run, plus the other schedules shown in /periodic. Use the Flow ID with flow_run, flow_update, or flow_delete.",
          input: Schema.Struct({}),
          output: KiloFlowRpc.ListOutput,
          options: { codemode: true },
          execute: (_, context) =>
            ctx.session.get({ sessionID: context.sessionID }).pipe(
              Effect.tap(refuseRunSession),
              Effect.flatMap((session) => list(ctx, schedules, session.projectID, runtime.fs)),
              Effect.map((output) => ({ output, content: inventory(output) })),
              Effect.mapError(toolError),
            ),
        })
        editor.add({
          name: "flow_update",
          description:
            "Change a managed local Flow. Pass the Flow ID and only the fields to change: name, prompt, when, ends (null removes the limit), worktree, model, agent, or permissions. permissions replaces the additional unattended patterns beyond the read, glob, and grep baseline, and the user approves a changed allowlist again before it is saved. Run history is kept.",
          input: KiloFlowRpc.UpdateRequest,
          output: KiloFlowRpc.Info,
          options: { codemode: true },
          execute: (input, context) =>
            ctx.session.get({ sessionID: context.sessionID }).pipe(
              Effect.tap(refuseRunSession),
              Effect.flatMap((session) =>
                update(ctx, schedules, { ...input, sessionID: context.sessionID }, session.projectID, runtime),
              ),
              Effect.map((flow) => ({ output: flow, content: `Updated Flow ${flow.name}.` })),
              Effect.mapError(toolError),
            ),
        })
        editor.add({
          name: "flow_delete",
          description:
            "Delete a managed local Flow: stops its active run and removes its schedule and run records. Run Sessions and worktrees are kept unless asked: deleteSessions also deletes the run Sessions (never the source Session), and deleteWorktrees also deletes the worktrees its runs created; a worktree with changes is kept.",
          input: KiloFlowRpc.RemoveInput,
          output: KiloFlowRpc.RemoveOutput,
          options: { codemode: true },
          execute: (input, context) =>
            ctx.session.get({ sessionID: context.sessionID }).pipe(
              Effect.tap(refuseRunSession),
              Effect.flatMap((session) => remove(ctx, schedules, input, session.projectID, runtime)),
              Effect.map((output) => ({
                output,
                content: [
                  `Deleted Flow ${input.flowID}.`,
                  ...(output.removedSessions?.length ? [`Deleted run Sessions: ${output.removedSessions.join(", ")}`] : []),
                  ...(output.keptSessions?.length
                    ? [`Run Sessions that could not be deleted: ${output.keptSessions.join(", ")}`]
                    : []),
                  ...(output.removedWorktrees?.length ? [`Deleted worktrees: ${output.removedWorktrees.join(", ")}`] : []),
                  ...(output.keptWorktrees?.length
                    ? [`Kept worktrees with changes or that could not be removed: ${output.keptWorktrees.join(", ")}`]
                    : []),
                ].join("\n"),
              })),
              Effect.mapError(toolError),
            ),
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
              Effect.tap(refuseRunSession),
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
              Effect.mapError(toolError),
            ),
        })
      })
      .pipe(Effect.orDie)
  }),
})

/**
 * A Flow run Session has a deny-by-default allowlist and reads repository content unattended, so it must not manage the
 * project's Flows: rewriting a more privileged Flow's prompt and running it would escape its own allowlist, creating
 * one could only fail at the approval its Session denies, and listing would expose other Flows' prompts and allowlists.
 */
function refuseRunSession(session: Session.Info) {
  if (Option.isNone(decodeMetadata(session.metadata?.[metadataKey]))) return Effect.void
  return Effect.fail(new Error(`Session ${session.id} runs a Flow and cannot list, create, start, change, or delete Flows`))
}

function toolError(error: unknown) {
  return new Tool.Error({ message: error instanceof Error ? error.message : String(error), error })
}

/** One line per Flow, for models that read tool content rather than output (Code Mode off). */
function inventory(output: KiloFlowRpc.ListOutput) {
  if (output.flows.length === 0) return "No Flows or schedules in this project."
  return output.flows
    .map((flow) =>
      [
        flow.reference.type === "managed" ? flow.reference.flowID : flow.reference.scheduleID,
        JSON.stringify(flow.name),
        flow.reference.type === "managed" ? "managed Flow" : "schedule",
        flow.status,
        describeWhen(flow.trigger.when),
        flow.nextRunAt === undefined ? undefined : `next ${new Date(flow.nextRunAt).toISOString()}`,
        flow.lastOutcome === undefined ? undefined : `last ${flow.lastOutcome}`,
        flow.health.status === "error" ? `error: ${flow.health.message}` : undefined,
      ]
        .filter(Boolean)
        .join(", "),
    )
    .join("\n")
}

function describeWhen(when: Schedule.When) {
  if (when.type === "in") return `in ${when.in}`
  if (when.type === "at") return `at ${when.at}`
  if (when.type === "every") return `every ${when.every}`
  return `cron "${when.cron}"`
}

export function create(
  ctx: Plugin.Context,
  schedules: Pick<Schedule.Interface, "create" | "remove" | "get">,
  input: KiloFlowRpc.CreateInput,
  projectID: Session.Info["projectID"] | undefined,
  runtime: Pick<Runtime, "changed" | "locks">,
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
    // A retried create reuses the client's request id, so it addresses the same Flow and the lock below serializes it.
    const id = input.requestID ? KiloFlowRpc.ID.make(`flw_${input.requestID}`) : KiloFlowRpc.ID.create()
    const record: KiloFlowRpc.Record = {
      version: 1,
      id,
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
      ...(input.ends ? { ends: input.ends } : {}),
      time: { created: now, updated: now },
    }
    const lock = flowLock(runtime, id)
    creating.set(lock, (creating.get(lock) ?? 0) + 1)
    return yield* lock.withPermit(
      Effect.gen(function* () {
        // A retried create may arrive after the first attempt committed but its response was lost. Return that Flow
        // instead of allocating a second one and a second backing schedule.
        const existing = Option.getOrUndefined(decodeRecord(yield* ctx.storage.get(`${prefix}${id}`)))
        if (existing) {
          if (existing.context.projectID !== session.projectID)
            return yield* Effect.fail(new Error(`Flow ${id} already exists`))
          // The same key with other settings is a conflict: returning the first Flow would silently drop the edits.
          if (!sameRequest(existing, record))
            return yield* Effect.fail(
              new FlowExists(id, `Flow ${id} was already created from this request with different settings`),
            )
          const schedule = existing.scheduleID
            ? Option.getOrUndefined(yield* schedules.get(existing.scheduleID).pipe(Effect.option))
            : undefined
          return managed(existing, schedule)
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
          .create(backingSchedule(record, session.id))
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
            schedules
              .remove(schedule.id)
              .pipe(Effect.ignore, Effect.andThen(ctx.storage.remove(key).pipe(Effect.ignore))),
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
        yield* Effect.logInfo("Flow created", {
          flowID: configured.id,
          projectID: session.projectID,
          name: configured.name,
          worktree: configured.execution.worktree,
          requestID: input.requestID,
        })
        yield* runtime.changed({ projectID: session.projectID, flowID: configured.id, kind: "created" })
        return managed(configured, schedule)
      }),
    ).pipe(
      // A create that ends without a Flow (refused approval, schedule or storage error) leaves nothing to lock again;
      // drop the lock so failed request ids do not keep a semaphore for the runtime's life. Only the last create still
      // holding or waiting on this lock may drop it: removing it under a queued create would let a later run or edit
      // take a fresh lock and run concurrently with that create.
      Effect.ensuring(
        Effect.gen(function* () {
          if (release(lock) > 0) return
          const stored = yield* ctx.storage.get(`${prefix}${id}`)
          if (stored === undefined && !creating.has(lock) && runtime.locks.get(id) === lock) runtime.locks.delete(id)
        }).pipe(Effect.ignore),
      ),
    )
  })
}

/** The native schedule row that fires a Flow. Its hook prompt is descriptive only: the scheduler never admits it. */
function backingSchedule(record: KiloFlowRpc.Record, sessionID: Session.ID): Schedule.CreateInput {
  return {
    sessionID,
    name: `Flow: ${record.name}`,
    when: record.trigger.when,
    ...(record.ends ? { ends: record.ends } : {}),
    action: { type: "hook", prompt: record.prompt },
  }
}

export function update(
  ctx: Plugin.Context,
  schedules: Pick<Schedule.Interface, "create" | "remove" | "get" | "pause">,
  input: KiloFlowRpc.UpdateInput,
  authorizedProjectID: Session.Info["projectID"],
  runtime: Runtime,
): Effect.Effect<KiloFlowRpc.Info, Error> {
  return Effect.gen(function* () {
    const current = yield* requireRecord(ctx, input.flowID, authorizedProjectID)
    const invalidPermission = input.permissions && validatePermissions(input.permissions)
    if (invalidPermission) return yield* Effect.fail(new Error(invalidPermission))
    const permissions = input.permissions ? flowPermissions(input.permissions) : (current.permissions ?? [])
    // Approval waits for the user, so it happens before the Flow lock that runs and removal also take.
    if (!samePermissions(permissions, current.permissions ?? []))
      yield* approve(ctx, {
        flowID: current.id,
        name: input.name ?? current.name,
        permissions,
        sessionID: input.sessionID ?? current.execution.sourceSessionID,
        projectID: authorizedProjectID,
        agent: input.agent ?? current.context.agent,
      })
    return yield* flowLock(runtime, current.id).withPermit(
      Effect.gen(function* () {
        // Read again under the lock: a run or another update may have changed the record while approval waited.
        const record = yield* requireRecord(ctx, input.flowID, authorizedProjectID)
        const ends = input.ends === null ? undefined : (input.ends ?? record.ends)
        const tz = input.when ? (input.when.tz ?? record.trigger.when.tz) : undefined
        const next: KiloFlowRpc.Record = {
          version: 1,
          id: record.id,
          name: input.name ?? record.name,
          authority: record.authority,
          trigger: input.when
            ? {
                type: "time",
                when: time({ ...input.when, tz }),
                timezone: tz ?? record.trigger.timezone,
              }
            : record.trigger,
          execution: { ...record.execution, worktree: input.worktree ?? record.execution.worktree },
          context: {
            ...record.context,
            model: input.model ?? record.context.model,
            agent: input.agent ?? record.context.agent,
          },
          prompt: input.prompt ?? record.prompt,
          // Only an approved new allowlist replaces the stored one; otherwise keep whatever is stored now.
          permissions: input.permissions ? permissions : (record.permissions ?? []),
          ...(ends ? { ends } : {}),
          ...(record.scheduleID ? { scheduleID: record.scheduleID } : {}),
          time: { ...record.time, updated: Date.now() },
        }
        const key = `${prefix}${record.id}`
        const previous = record.scheduleID
          ? Option.getOrUndefined(yield* schedules.get(record.scheduleID).pipe(Effect.option))
          : undefined
        // There is no schedule update: a new trigger or limit replaces the backing row. Its native run counters
        // restart, while the Flow's own run records keep the history users see. A rename or a new prompt keeps the
        // row, whose descriptive name and hook prompt then lag behind; inventories read the Flow record instead.
        if (input.when === undefined && input.ends === undefined) {
          yield* ctx.storage
            .set(key, JSON.stringify(next))
            .pipe(Effect.mapError(() => new Error(`Couldn't save Flow ${record.id}`)))
          yield* notify(runtime, next, "updated")
          return managed(next, previous, (yield* latest(ctx, record.id)).run)
        }
        const created = yield* schedules
          .create(backingSchedule(next, record.execution.sourceSessionID))
          .pipe(Effect.mapError((error) => new Error(`Couldn't reschedule Flow ${record.id}: ${error.message}`)))
        const discard = schedules.remove(created.id).pipe(Effect.ignore)
        const schedule =
          previous?.status === "paused"
            ? yield* schedules.pause(created.id).pipe(
                Effect.mapError((error) => new Error(error.message)),
                Effect.onError(() => discard),
              )
            : created
        const rescheduled: KiloFlowRpc.Record = {
          ...next,
          trigger: next.trigger.type === "time" ? { ...next.trigger, timezone: schedule.tz } : next.trigger,
          scheduleID: schedule.id,
        }
        yield* ctx.storage.set(key, JSON.stringify(rescheduled)).pipe(
          Effect.mapError(() => new Error(`Couldn't save Flow ${record.id}`)),
          Effect.onError(() => discard),
        )
        yield* ctx.storage.set(scheduleKey(schedule.id), record.id)
        if (record.scheduleID) {
          yield* ctx.storage.remove(scheduleKey(record.scheduleID))
          yield* schedules.remove(record.scheduleID).pipe(Effect.ignore)
        }
        yield* notify(runtime, rescheduled, "updated")
        return managed(rescheduled, schedule, (yield* latest(ctx, record.id)).run)
      }),
    )
  })
}

/** Asks the user to approve a Flow's unattended allowlist in a Session of the Flow's project. */
function approve(
  ctx: Plugin.Context,
  input: {
    readonly flowID: KiloFlowRpc.ID
    readonly name: string
    readonly permissions: readonly KiloFlowRpc.PermissionGrant[]
    readonly sessionID: Session.ID
    readonly projectID: Session.Info["projectID"]
    readonly agent: Agent.ID | undefined
  },
) {
  return Effect.gen(function* () {
    const session = yield* ctx.session
      .get({ sessionID: input.sessionID })
      .pipe(Effect.mapError(() => new Error(`Session ${input.sessionID} does not exist`)))
    if (session.projectID !== input.projectID)
      return yield* Effect.fail(new Error(`Session ${input.sessionID} does not exist`))
    yield* ctx.permission.assert({
      action: permissionAction,
      resources: input.permissions.map((permission) => `${permission.action}: ${permission.resource}`),
      sessionID: session.id,
      agent: input.agent ?? session.agent,
      metadata: {
        [metadataKey]: {
          flowID: input.flowID,
          name: input.name,
          permissions: input.permissions,
          unattended: true,
        },
      },
    })
  })
}

/** A retried create collided with a Flow its request id already created with different settings. */
class FlowExists extends Error {
  constructor(
    readonly flowID: KiloFlowRpc.ID,
    message: string,
  ) {
    super(message)
  }
}

/** True when a stored Flow and a freshly built record describe the same create request. */
function sameRequest(stored: KiloFlowRpc.Record, requested: KiloFlowRpc.Record) {
  return (
    stored.name === requested.name &&
    stored.prompt === requested.prompt &&
    stored.execution.sourceSessionID === requested.execution.sourceSessionID &&
    stored.execution.worktree === requested.execution.worktree &&
    stored.trigger.timezone === requested.trigger.timezone &&
    canonical(stored.trigger.when) === canonical(requested.trigger.when) &&
    canonical(stored.ends) === canonical(requested.ends) &&
    canonical(stored.context.model) === canonical(requested.context.model) &&
    stored.context.agent === requested.context.agent &&
    samePermissions(stored.permissions ?? [], requested.permissions ?? [])
  )
}

// Key-order independent JSON, so a decoded record compares equal to one built in memory.
function canonical(value: unknown): string {
  if (value === undefined) return ""
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  return `{${Object.entries(value)
    .filter((entry) => entry[1] !== undefined)
    .toSorted((a, b) => a[0].localeCompare(b[0]))
    .map((entry) => `${JSON.stringify(entry[0])}:${canonical(entry[1])}`)
    .join(",")}}`
}

function samePermissions(
  left: readonly KiloFlowRpc.PermissionGrant[],
  right: readonly KiloFlowRpc.PermissionGrant[],
) {
  const key = (permission: KiloFlowRpc.PermissionGrant) => `${permission.action}\u0000${permission.resource}`
  const known = new Set(right.map(key))
  return left.length === right.length && left.every((permission) => known.has(key(permission)))
}

function notify(runtime: Pick<Runtime, "changed">, record: KiloFlowRpc.Record, kind: KiloFlowRpc.Changed["kind"]) {
  if (!record.context.projectID) return Effect.void
  return runtime.changed({ projectID: record.context.projectID, flowID: record.id, kind })
}

function history(ctx: Plugin.Context, input: KiloFlowRpc.ControlInput, authorizedProjectID: Session.Info["projectID"]) {
  return Effect.gen(function* () {
    const record = yield* requireRecord(ctx, input.flowID, authorizedProjectID)
    const stored = yield* runs(ctx, [record.id])
    return { runs: stored.runs.toSorted(newest), warnings: stored.warnings }
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
  runtime: Pick<Runtime, "changed">,
) {
  return Effect.gen(function* () {
    const record = yield* requireRecord(ctx, input.flowID, authorizedProjectID)
    if (!record.scheduleID) return yield* Effect.fail(new Error(`Flow ${record.id} has no backing schedule`))
    const schedule = yield* (operation === "pause"
      ? schedules.pause(record.scheduleID)
      : schedules.resume(record.scheduleID)
    ).pipe(Effect.mapError((error) => new Error(error.message)))
    yield* notify(runtime, record, "updated")
    return managed(record, schedule, (yield* latest(ctx, record.id)).run)
  })
}

function remove(
  ctx: Plugin.Context,
  schedules: Pick<Schedule.Interface, "remove">,
  input: KiloFlowRpc.RemoveInput,
  authorizedProjectID: Session.Info["projectID"],
  runtime: Runtime,
): Effect.Effect<KiloFlowRpc.RemoveOutput, Error> {
  return Effect.gen(function* () {
    const record = yield* requireRecord(ctx, input.flowID, authorizedProjectID)
    const lock = flowLock(runtime, record.id)
    const { worktrees, sessions } = yield* lock.withPermit(
      Effect.gen(function* () {
        const active = yield* reconcileFlowActive(ctx, record.id)
        if (active?.sessionID) yield* ctx.session.interrupt({ sessionID: active.sessionID }).pipe(Effect.ignore)
        // Read the run worktrees and Sessions before the run records go away.
        const worktrees = input.deleteWorktrees ? yield* runWorktrees(ctx, record) : []
        const sessions = input.deleteSessions ? yield* runSessions(ctx, record) : []
        if (record.scheduleID)
          yield* schedules.remove(record.scheduleID).pipe(
            Effect.catchTag("Schedule.NotFoundError", () => Effect.void),
          )
        // Remove the definition keys first so a failed run cleanup cannot leave a half-removed Flow listed.
        yield* Effect.all(
          [
            ctx.storage.remove(`${prefix}${record.id}`),
            ctx.storage.remove(activeKey(record.id)),
            ctx.storage.remove(latestKey(record.id)),
            ...(record.scheduleID ? [ctx.storage.remove(scheduleKey(record.scheduleID))] : []),
          ],
          { discard: true },
        )
        yield* removeRuns(ctx, record.id)
        return { worktrees, sessions }
      }),
    )
    if (runtime.locks.get(record.id) === lock) runtime.locks.delete(record.id)
    yield* notify(runtime, record, "removed")
    // Sessions go before worktrees: a run Session may live in the worktree being removed. A Session that cannot be
    // removed is reported, never a reason to fail the delete of a Flow that is already gone.
    const sessionResults = yield* Effect.forEach(sessions, (sessionID) =>
      ctx.session.remove({ sessionID }).pipe(
        Effect.as({ sessionID, removed: true }),
        Effect.catchCause(() => Effect.succeed({ sessionID, removed: false })),
      ),
    )
    const sessionOutput =
      sessions.length === 0
        ? {}
        : {
            removedSessions: sessionResults.filter((result) => result.removed).map((result) => result.sessionID),
            keptSessions: sessionResults.filter((result) => !result.removed).map((result) => result.sessionID),
          }
    const projectID = record.context.projectID
    // Without force, git refuses to remove a worktree with changes, so a refusal keeps the user's work.
    const worktreeResults =
      projectID === undefined
        ? []
        : yield* Effect.forEach(worktrees, (directory) =>
            ctx.worktree.remove({ projectID, directory, force: false }).pipe(
              Effect.as({ directory, removed: true }),
              Effect.catchCause(() => Effect.succeed({ directory, removed: false })),
            ),
          )
    const worktreeOutput =
      worktreeResults.length === 0
        ? {}
        : {
            removedWorktrees: worktreeResults.filter((result) => result.removed).map((result) => result.directory),
            keptWorktrees: worktreeResults.filter((result) => !result.removed).map((result) => result.directory),
          }
    yield* Effect.logInfo("Flow removed", {
      flowID: record.id,
      projectID: authorizedProjectID,
      name: record.name,
      deleteWorktrees: input.deleteWorktrees === true,
      deleteSessions: input.deleteSessions === true,
      removedSessions: sessionOutput.removedSessions?.length ?? 0,
      removedWorktrees: worktreeOutput.removedWorktrees?.length ?? 0,
    })
    return { ...sessionOutput, ...worktreeOutput }
  })
}

/**
 * The run Sessions of a Flow, never its source Session. Retained run records name recent ones; every run Session also
 * carries the Flow in its metadata, so a project scan finds the runs whose records retention already pruned.
 */
function runSessions(ctx: Plugin.Context, record: KiloFlowRpc.Record) {
  return Effect.gen(function* () {
    const stored = yield* runs(ctx, [record.id])
    const recorded = stored.runs.flatMap((run) => (run.sessionID ? [run.sessionID] : []))
    const scanned = yield* flowSessions(ctx, record)
    return [...new Set([...recorded, ...scanned])].filter((sessionID) => sessionID !== record.execution.sourceSessionID)
  })
}

/** Project run Sessions (not forks of them) whose Flow metadata names this Flow, read page by page. */
function flowSessions(ctx: Plugin.Context, record: KiloFlowRpc.Record) {
  const projectID = record.context.projectID
  if (!projectID) return Effect.succeed<Session.ID[]>([])
  const page = (
    cursor: Session.ListCursor | undefined,
    found: Session.ID[],
  ): Effect.Effect<Session.ID[], never> =>
    ctx.session.list({ project: projectID, limit: 200, ...(cursor ? { cursor } : {}) }).pipe(
      Effect.flatMap((output) => {
        // A fork copies its parent's metadata, so a Session the user forked from a run still names the Flow. Forks are
        // never run Sessions, and deleting one would remove a transcript the user kept on purpose.
        const matched = output.data.flatMap((session) =>
          session.fork === undefined &&
          Option.getOrUndefined(decodeMetadata(session.metadata?.[metadataKey]))?.flowID === record.id
            ? [session.id]
            : [],
        )
        const next = output.cursor.next
        return next && output.data.length > 0 ? page(next, [...found, ...matched]) : Effect.succeed([...found, ...matched])
      }),
      // A failed scan still deletes the recorded run Sessions; it only misses older ones.
      Effect.catchCause(() => Effect.succeed(found)),
    )
  return page(undefined, [])
}

/**
 * The worktree roots a Flow created. Retained runs record their root, and every worktree a Flow creates is named after
 * it, so the project listing also finds the roots whose run record retention already pruned.
 */
function runWorktrees(ctx: Plugin.Context, record: KiloFlowRpc.Record) {
  return Effect.gen(function* () {
    const stored = yield* runs(ctx, [record.id])
    const recorded = stored.runs.flatMap((run) => (run.worktreeDirectory ? [run.worktreeDirectory] : []))
    const projectID = record.context.projectID
    if (!projectID) return [...new Set(recorded)]
    const listed = yield* ctx.worktree.list({ projectID }).pipe(Effect.catchCause(() => Effect.succeed([])))
    const named = listed
      .filter((worktree) => path.basename(worktree.directory).startsWith(`${record.id}-`))
      .map((worktree) => worktree.directory)
    return [...new Set([...recorded, ...named])]
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
  schedules: Pick<Schedule.Interface, "pause">,
  schedule: Schedule.Info,
  flowID: KiloFlowRpc.ID,
  runtime: Runtime,
): Effect.Effect<"fired" | "skipped" | "paused" | "orphaned", Error> {
  return Effect.gen(function* () {
    const record = Option.getOrUndefined(decodeRecord(yield* ctx.storage.get(`${prefix}${flowID}`)))
    if (!record || record.id !== flowID || (record.scheduleID !== undefined && record.scheduleID !== schedule.id)) {
      // A stale index must not retry forever; the hook action is never admitted, so the row simply advances.
      yield* Effect.logWarning("removing stale Flow schedule index", { scheduleID: schedule.id, flowID })
      yield* ctx.storage.remove(scheduleKey(schedule.id))
      return "orphaned" as const
    }
    if (schedule.nextDueAt === undefined)
      return yield* Effect.fail(new Error(`Backing schedule ${schedule.id} has no due time`))
    const dueAt = DateTime.toEpochMillis(schedule.nextDueAt)
    const directory = record.context.directory
    if (directory && !(yield* runtime.fs.isDir(directory))) {
      // Every retry would fail the same way, so the schedule stops until the user restores the directory and
      // resumes the Flow, or repairs it. The scheduler still records this occurrence, so a resume waits for the next.
      yield* schedules.pause(schedule.id).pipe(Effect.ignore)
      const now = Date.now()
      yield* persistRun(ctx, {
        version: 1,
        id: KiloFlowRpc.RunID.make(`flr_${record.id.slice(4)}_${dueAt}`),
        flowID: record.id,
        status: "failed",
        worktree: record.execution.worktree,
        scheduled: { scheduleID: schedule.id, dueAt },
        error: missingDirectory(directory),
        time: { created: now, updated: now, completed: now },
      })
      yield* notify(runtime, record, "run")
      return "paused" as const
    }
    const execution = yield* start(
      ctx,
      record,
      KiloFlowRpc.RunID.make(`flr_${record.id.slice(4)}_${dueAt}`),
      runtime,
      { scheduleID: schedule.id, dueAt },
    )
    if (execution.status === "skipped") return "skipped" as const
    if (execution.status === "failed" && execution.time.started === undefined)
      return yield* Effect.fail(new Error(execution.error ?? `Flow ${record.id} failed to start`))
    return "fired" as const
  })
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
      // A re-dispatched occurrence reuses its deterministic run. Only a run that reached its Session is final:
      // a skipped slot or a start that failed before the Session existed is attempted again.
      if (existing?.flowID === record.id && existing.id === runID && !retryable(existing)) return existing

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
      // A start that fails before its Session exists also drops the worktree it created, so a failed start leaves nothing
      // behind. A refused removal (changes in the tree) keeps the root recorded for a retry to reuse.
      const fail = (error: unknown) =>
        Effect.gen(function* () {
          const stored = Option.getOrUndefined(decodeRun(yield* ctx.storage.get(runKey(initial))))
          const run = stored?.id === initial.id ? stored : initial
          if (run.status !== "starting" || !run.worktreeDirectory) return yield* failRun(ctx, run, error)
          const removed = yield* ctx.worktree
            .remove({ projectID, directory: run.worktreeDirectory, force: false })
            .pipe(Effect.as(true), Effect.catchCause(() => Effect.succeed(false)))
          return yield* failRun(ctx, removed ? { ...run, worktreeDirectory: undefined } : run, error)
        })
      if (!(yield* runtime.fs.isDir(directory))) return yield* fail(new Error(missingDirectory(directory)))

      // A retried occurrence reuses the worktree an earlier attempt kept, so retries never pile up worktrees.
      const kept =
        existing?.worktreeDirectory && (yield* runtime.fs.isDir(existing.worktreeDirectory))
          ? existing.worktreeDirectory
          : undefined
      const canonicalDirectory = AbsolutePath.make(yield* runtime.fs.resolve(directory))
      const target: Effect.Effect<{ readonly root?: AbsolutePath; readonly directory: AbsolutePath }, unknown> =
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
              const root =
                kept ??
                (yield* ctx.worktree.create({
                  projectID,
                  from: source.worktree.directory,
                  name: `${record.id}-${initial.id}`,
                })).directory
              // Record the root before anything else can fail, so cleanup and retries can find it.
              yield* persistRun(ctx, { ...initial, worktreeDirectory: root, time: { ...initial.time, updated: Date.now() } })
              return {
                root,
                directory: AbsolutePath.make(
                  yield* runtime.fs.resolve(path.resolve(root, path.relative(source.canonical, canonicalDirectory))),
                ),
              }
            })
          : Effect.succeed({ directory: canonicalDirectory })
      const targetResult = yield* target.pipe(
        Effect.onInterrupt(() => fail(new Error("Flow start was interrupted")).pipe(Effect.asVoid)),
        Effect.result,
      )
      if (targetResult._tag === "Failure") return yield* fail(targetResult.failure)

      const admitting: KiloFlowRpc.Run = {
        ...initial,
        sessionID: Session.ID.make(`ses_flow_${initial.id.slice(4)}`),
        directory: targetResult.success.directory,
        ...(targetResult.success.root ? { worktreeDirectory: targetResult.success.root } : {}),
        time: { ...initial.time, updated: Date.now() },
      }
      yield* persistRun(ctx, admitting)
      const sessionResult = yield* ctx.session
        .create({
          id: admitting.sessionID,
          title: `Flow: ${record.name}`,
          agent,
          model,
          location: { directory: targetResult.success.directory },
          metadata: { [metadataKey]: { flowID: record.id, runID: initial.id } },
          permissions: [
            { action: "*", resource: "*", effect: "deny" },
            ...(record.permissions ?? []).map((permission) => ({ ...permission, effect: "allow" as const })),
          ],
        })
        .pipe(
          Effect.onInterrupt(() => fail(new Error("Flow start was interrupted")).pipe(Effect.asVoid)),
          Effect.result,
        )
      if (sessionResult._tag === "Failure") return yield* fail(sessionResult.failure)

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
  ).pipe(Effect.ensuring(notify(runtime, record, "run")))
}

function missingDirectory(directory: string) {
  return `Flow directory ${directory} no longer exists`
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
  fs: Pick<FSUtil.Interface, "isDir">,
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
    // Storage failures and records whose owner can't be read stay visible; another project's records stay hidden.
    const storedWarnings = stored.warnings
      .filter((item) => item.projectID === undefined || item.projectID === projectID)
      .map((item) => item.warning)
    const latestRuns = yield* Effect.forEach(scopedRecords, (record) => latest(ctx, record.id), {
      concurrency: lookups,
    })
    const missing = yield* Effect.forEach(
      scopedRecords,
      (record) =>
        record.context.directory
          ? fs.isDir(record.context.directory).pipe(Effect.map((exists) => (exists ? [] : [record.id])))
          : Effect.succeed([]),
      { concurrency: lookups },
    ).pipe(Effect.map((ids) => new Set(ids.flat())))
    const managedScheduleIDs = new Set(
      stored.records.flatMap((record) => (record.scheduleID ? [record.scheduleID] : [])),
    )
    const unowned = native.filter((schedule) => !managedScheduleIDs.has(schedule.id))
    const sessions = yield* Effect.forEach(
      unowned,
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
      { concurrency: lookups },
    ).pipe(Effect.map((entries) => new Map(entries)))
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
      runs: latestRuns.flatMap((item) => (item.run ? [item.run] : [])),
      schedules: scopedSchedules,
      sessions,
      missing,
      warnings: [...nativeWarnings, ...storedWarnings, ...latestRuns.flatMap((item) => item.warnings)],
      observedAt,
    })
  })
}

export function assemble(input: {
  readonly records: readonly KiloFlowRpc.Record[]
  readonly runs?: readonly KiloFlowRpc.Run[]
  readonly schedules: readonly Schedule.Info[]
  readonly sessions: ReadonlyMap<Schedule.ID, Session.Info | undefined>
  /** Flows whose source directory no longer exists. */
  readonly missing?: ReadonlySet<KiloFlowRpc.ID>
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
        managed(
          record,
          record.scheduleID ? native.get(record.scheduleID) : undefined,
          latest.get(record.id),
          input.missing?.has(record.id),
        ),
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
  missing = false,
): KiloFlowRpc.Info {
  const shared = {
    reference: {
      type: "managed" as const,
      flowID: record.id,
      ...(record.scheduleID ? { scheduleID: record.scheduleID } : {}),
    },
    name: record.name,
    authority: record.authority,
    trigger: record.trigger,
    execution: record.execution,
    context: record.context,
    prompt: record.prompt,
    permissions: record.permissions ?? [],
    ...(record.ends ? { ends: record.ends } : {}),
    time: record.time,
  }
  const health: KiloFlowRpc.Health =
    missing && record.context.directory
      ? { status: "error", message: missingDirectory(record.context.directory), reason: "directory-missing" }
      : { status: "healthy" }
  if (!record.scheduleID)
    return {
      ...shared,
      status: "paused",
      ...(run ? { lastRunAt: run.time.started ?? run.time.created } : {}),
      ...(run && outcome(run) ? { lastOutcome: outcome(run) } : {}),
      ...(run ? { latestRun: run } : {}),
      health,
    }
  if (!schedule)
    return {
      ...shared,
      status: "error",
      health: { status: "error", message: `Backing schedule ${record.scheduleID} no longer exists` },
    }
  return {
    ...shared,
    status: status(schedule.status),
    nextRunAt: instant(schedule.nextDueAt),
    lastRunAt: run?.time.started ?? run?.time.created ?? instant(schedule.lastFiredAt),
    lastOutcome: (run && outcome(run)) ?? schedule.lastOutcome,
    ...(schedule.endsAt ? { endsAt: instant(schedule.endsAt) } : {}),
    ...(schedule.remainingRuns === undefined ? {} : { remainingRuns: schedule.remainingRuns }),
    ...(run ? { latestRun: run } : {}),
    health,
  }
}

function outcome(run: KiloFlowRpc.Run): KiloFlowRpc.RunOutcome | undefined {
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
    reference: { type: "native-schedule", scheduleID: schedule.id, action: schedule.action.type },
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

type Entry = { readonly key: string; readonly value: Schema.Json }

/** Pages through a storage prefix. A failed or defective scan keeps the entries already read and reports why. */
function scan(ctx: Plugin.Context, from: string) {
  const entries: Entry[] = []
  return Effect.gen(function* () {
    let after: string | undefined
    do {
      const page = yield* ctx.storage.scan({ prefix: from, after })
      entries.push(...page.entries)
      after = page.next
    } while (after !== undefined)
    return { entries, error: undefined as string | undefined }
  }).pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause) ? Effect.interrupt : Effect.succeed({ entries, error: Cause.pretty(cause) }),
    ),
  )
}

function records(ctx: Plugin.Context) {
  return Effect.gen(function* () {
    const page = yield* scan(ctx, prefix)
    const found: KiloFlowRpc.Record[] = []
    const warnings: { readonly warning: KiloFlowRpc.Warning; readonly projectID?: string }[] = page.error
      ? [{ warning: { source: "managed", message: `Couldn't read managed Flow records: ${page.error}` } }]
      : []
    page.entries.forEach((entry) => {
      const decoded = storedRecord(entry.key, entry.value)
      if (decoded.record) found.push(decoded.record)
      if (decoded.warning) warnings.push({ warning: decoded.warning, projectID: owner(entry.value) })
    })
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
          const page = yield* scan(ctx, `${runPrefix}${flowID}:`)
          if (page.error)
            warnings.push({
              source: "managed-run",
              reference: flowID,
              message: `Couldn't read Flow run records: ${page.error}`,
            })
          page.entries.forEach((entry) => {
            const decoded = Option.getOrUndefined(decodeRun(entry.value))
            if (decoded && decoded.flowID === flowID && entry.key === runKey(decoded)) found.push(decoded)
            else
              warnings.push({
                source: "managed-run",
                reference: entry.key,
                message: "Stored Flow run record is malformed or stale",
              })
          })
        }),
      { discard: true },
    )
    return { runs: found, warnings }
  })
}

function newest(left: KiloFlowRpc.Run, right: KiloFlowRpc.Run) {
  return right.time.created - left.time.created || right.id.localeCompare(left.id)
}

function latestRun(runs: readonly KiloFlowRpc.Run[], flowID: KiloFlowRpc.ID) {
  return runs.filter((run) => run.flowID === flowID && run.status !== "skipped").toSorted(newest)[0]
}

/** Reads the latest non-skipped run through its index, rebuilding the index from the run records when it is absent. */
function latest(ctx: Plugin.Context, flowID: KiloFlowRpc.ID) {
  return Effect.gen(function* () {
    const id = Option.getOrUndefined(decodeRunID(yield* ctx.storage.get(latestKey(flowID))))
    const indexed = id && Option.getOrUndefined(decodeRun(yield* ctx.storage.get(runKey({ flowID, id }))))
    if (indexed && indexed.flowID === flowID && indexed.id === id && indexed.status !== "skipped")
      return { run: indexed, warnings: [] }
    const stored = yield* runs(ctx, [flowID])
    const run = latestRun(stored.runs, flowID)
    if (run) yield* ctx.storage.set(latestKey(flowID), run.id)
    if (!run && id) yield* ctx.storage.remove(latestKey(flowID))
    return { run, warnings: stored.warnings }
  })
}

function pruneRuns(ctx: Plugin.Context, flowID: KiloFlowRpc.ID) {
  return Effect.gen(function* () {
    const stored = yield* runs(ctx, [flowID])
    const active = Option.getOrUndefined(decodeRunID(yield* ctx.storage.get(activeKey(flowID))))
    const sorted = stored.runs.toSorted(newest)
    // Skipped placeholders have their own budget so frequent skips never evict real execution history.
    const keep = new Set<KiloFlowRpc.RunID>([
      ...(active ? [active] : []),
      ...sorted.filter((run) => run.status !== "skipped").slice(0, KiloFlowRpc.retainedRuns).map((run) => run.id),
      ...sorted.filter((run) => run.status === "skipped").slice(0, KiloFlowRpc.retainedRuns).map((run) => run.id),
    ])
    const stale = stored.runs.filter((run) => !keep.has(run.id))
    yield* Effect.forEach(stale, (run) => ctx.storage.remove(runKey(run)), { discard: true })
  })
}

function removeRuns(ctx: Plugin.Context, flowID: KiloFlowRpc.ID) {
  return Effect.gen(function* () {
    const page = yield* scan(ctx, `${runPrefix}${flowID}:`)
    yield* Effect.forEach(page.entries, (entry) => ctx.storage.remove(entry.key), { discard: true })
    if (page.error) yield* Effect.logWarning("failed to remove every Flow run record", { flowID, error: page.error })
  })
}

function persistRun(ctx: Plugin.Context, run: KiloFlowRpc.Run) {
  return Effect.gen(function* () {
    yield* ctx.storage.set(runKey(run), JSON.stringify(run))
    if (run.status !== "skipped") {
      const id = Option.getOrUndefined(decodeRunID(yield* ctx.storage.get(latestKey(run.flowID))))
      const current =
        id && id !== run.id
          ? Option.getOrUndefined(decodeRun(yield* ctx.storage.get(runKey({ flowID: run.flowID, id }))))
          : undefined
      if (id !== run.id && (!current || newest(run, current) <= 0)) yield* ctx.storage.set(latestKey(run.flowID), run.id)
    }
    yield* pruneRuns(ctx, run.flowID)
  })
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

/** Creates holding or waiting on each Flow lock, so a failed create never drops a lock another create still needs. */
const creating = new WeakMap<Semaphore.Semaphore, number>()

/** Marks one create as done with `lock`; returns how many creates still use it. */
function release(lock: Semaphore.Semaphore) {
  const users = (creating.get(lock) ?? 1) - 1
  if (users > 0) creating.set(lock, users)
  if (users <= 0) creating.delete(lock)
  return users
}

function flowLock(runtime: Pick<Runtime, "locks">, flowID: KiloFlowRpc.ID) {
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

function latestKey(flowID: KiloFlowRpc.ID) {
  return `${latestPrefix}${flowID}`
}

/** The project of a stored record that no longer decodes, when its context can still be read. */
function owner(value: Schema.Json) {
  return Option.getOrUndefined(decodeOwner(value))?.context.projectID
}

function retryable(run: KiloFlowRpc.Run) {
  return run.status === "skipped" || (run.status === "failed" && run.time.started === undefined)
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
    const matched = yield* withStoredRun(ctx, runtime, session, (stored) =>
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
    if (matched) yield* runChanged(runtime, session)
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
    const matched = yield* withStoredRun(ctx, runtime, session, (stored) =>
      persistRun(ctx, {
        ...stored,
        error: `Flow permission policy blocked ${permission} for ${resources.map((resource) => JSON.stringify(resource)).join(", ")} while running ${tool}`,
        time: { ...stored.time, updated: Date.now() },
      }),
    )
    // Only an active Flow run is stopped. Ordinary Sessions keep the tool error and continue.
    if (!matched) return
    yield* runChanged(runtime, session)
    yield* ctx.session.interrupt({ sessionID }).pipe(Effect.ignore)
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("failed to record Flow permission error", { sessionID, tool, cause }),
    ),
  )
}

function runChanged(runtime: Pick<Runtime, "changed">, session: Session.Info) {
  const metadata = Option.getOrUndefined(decodeMetadata(session.metadata?.[metadataKey]))
  if (!metadata) return Effect.void
  return runtime.changed({ projectID: session.projectID, flowID: metadata.flowID, kind: "run" })
}

function withStoredRun(
  ctx: Plugin.Context,
  runtime: Runtime,
  session: Session.Info,
  update: (run: KiloFlowRpc.Run) => Effect.Effect<void>,
) {
  return Effect.gen(function* () {
    const metadata = Option.getOrUndefined(decodeMetadata(session.metadata?.[metadataKey]))
    if (!metadata) return false
    return yield* flowLock(runtime, metadata.flowID).withPermit(
      Effect.gen(function* () {
        const stored = Option.getOrUndefined(
          decodeRun(yield* ctx.storage.get(runKey({ flowID: metadata.flowID, id: metadata.runID }))),
        )
        if (!stored || stored.sessionID !== session.id) return false
        if (stored.status !== "starting" && stored.status !== "running") return false
        yield* update(stored)
        return true
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
