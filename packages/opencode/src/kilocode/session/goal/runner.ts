import { Cause, Deferred, Effect, Exit, Scope, Semaphore } from "effect"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { NamedError } from "@opencode-ai/core/util/error"
import type { EventV2 } from "@opencode-ai/core/event"
import { Interrupted } from "@opencode-ai/schema/kilocode/session-drain"
import { Command } from "@/command"
import { EffectBridge } from "@/effect/bridge"
import { InstanceRef } from "@/effect/instance-ref"
import { InstanceState } from "@/effect/instance-state"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Permission } from "@/permission"
import { Provider } from "@/provider/provider"
import { Question } from "@/question"
import { Session } from "@/session/session"
import type { CommandInput, PromptInput } from "@/session/prompt"
import { SessionRunState } from "@/session/run-state"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { Suggestion } from "@/kilocode/suggestion"
import { KiloSessionControl } from "../control"
import { GoalState } from "./state"
import { GoalLink } from "./link"
import { GoalPolicy } from "./policy"
import { GoalInstructions } from "./instructions"
import { SessionDrain } from "../drain"
import { KiloSessionPrompt } from "../prompt"
import { KiloSessionPromptQueue } from "../prompt-queue"
import { isRecord } from "@/util/record"

export namespace Goal {
  export type Action = "start" | "resume"
  export type ArmInput = {
    sessionID: SessionID
    action: Action
    objective?: string
    snapshotInitialization?: "wait"
    note?: string
  }
  export type ArmResult = { text: string }
  export type Ops = { arm: (input: ArmInput) => Effect.Effect<ArmResult, Error> }
  type RunModel = ReturnType<typeof Provider.parseModel> & { variant?: string }

  function runTarget(session: Session.Info, user?: SessionV1.User): { model: RunModel; agent: string } {
    const model: RunModel =
      user?.model ??
      (session.model
        ? { providerID: session.model.providerID, modelID: session.model.id, variant: session.model.variant }
        : { ...Provider.parseModel("local/goal"), variant: undefined })
    return { model, agent: user?.agent ?? session.agent ?? "code" }
  }

  function matches<D extends EventV2.Definition>(event: EventV2.Payload, definition: D): event is EventV2.Payload<D> {
    return event.type === definition.type
  }

  export function action(part: typeof SessionV1.ToolPart.Type) {
    const meta = part.state.status === "pending" ? undefined : part.state.metadata
    const approval = isRecord(meta?.approval) ? meta.approval : undefined
    const rule = isRecord(approval?.rule) ? approval.rule : undefined
    if (meta?.dismissed === true || meta?.interrupted === true || rule?.action === "deny" || part.tool === "plan_exit")
      return "blocked"
    if (part.state.status !== "completed" && part.state.status !== "error") return "none"
    if (part.state.status === "error" || (part.tool === "bash" && meta?.exit !== 0) || meta?.error === true)
      return "failed"
    if (["question", "suggest", "todowrite", "board_post", "board_read", "goal_report"].includes(part.tool))
      return "none"
    if (part.tool === "task" && meta?.background === true) return "none"
    // A scheduling call that arms a timer is a wait the goal suspends on; the
    // calls that only inspect or cancel a wait are bookkeeping, not progress.
    if (GoalLink.bookkeeping(part.tool)) return "none"
    if (part.tool === "schedule_wakeup" || part.tool === "cron_create") return GoalLink.waitFor(part) ? "wait" : "none"
    if (part.tool === "background_process") {
      if (GoalLink.waitFor(part)) return "wait"
      // A start or monitor that already reached a terminal status is done work;
      // list, status, logs, stop and restart are bookkeeping.
      const call = part.state.input?.action
      if (call === "start" || call === "monitor") return "success"
      return "none"
    }
    return "success"
  }

  function outcome(id: SessionID, parent: MessageID, current: () => boolean) {
    const create = () => ({
      bases: new Set<MessageID>(),
      message: undefined as { id: MessageID; finish?: string } | undefined,
      calls: new Map<PartID, { start: number; settled: boolean }>(),
    })
    const parents = new Set([parent])
    const root = create()
    root.bases.add(parent)
    const owned = new Map([[id, root]])
    let sequence = 0
    let success = 0
    let failure = 0
    let blocked = false
    let errored = false
    let open = true
    let report: GoalPolicy.Report | undefined
    let wait: GoalLink.Wait | undefined
    const owner: GoalPolicy.Owner = {
      root: id,
      report: (message, value) => {
        if (!open || !current() || root.message?.id !== message) return false
        report = value
        return true
      },
      current: () => open && current(),
      input: (input) => {
        if (!open || !current()) return input
        const messageID = input.messageID ?? MessageID.ascending()
        const state = owned.get(input.sessionID) ?? create()
        state.bases.add(messageID)
        owned.set(input.sessionID, state)
        GoalPolicy.track(messageID, owner)
        if (input.sessionID === id) parents.add(messageID)
        return { ...input, messageID }
      },
      fail: () => {
        if (open && current()) errored = true
      },
    }
    GoalPolicy.track(parent, owner)

    function update(event: EventV2.Payload) {
      if (event.metadata?.fork) return
      const data = event.data
      if (!isRecord(data) || typeof data.sessionID !== "string") return
      const state = owned.get(SessionID.make(data.sessionID))
      if (!state) return
      const base = KiloSessionPromptQueue.active(SessionID.make(data.sessionID))
      const active = base && state.bases.has(base)
      if (matches(event, Permission.Event.Replied)) {
        if (active && event.data.reply === "reject") blocked = true
        return
      }
      if (matches(event, Question.Event.Rejected) || matches(event, Interrupted)) {
        if (active) blocked = true
        return
      }
      if (matches(event, Session.Event.Error)) {
        if (event.metadata?.phase === "admission") return
        if (active && event.data.error?.name !== "ContextOverflowError") errored = true
        return
      }
      if (matches(event, SessionV1.Event.MessageUpdated)) {
        const info = event.data.info
        if (info.role !== "assistant" || info.summary) return
        if (state.message?.id !== info.id) {
          const owner = KiloSessionPromptQueue.owner(info.sessionID, info.parentID)
          if (!owner || !state.bases.has(owner) || info.time.completed != null) return
          if (info.sessionID === id) parents.add(info.parentID)
          state.message = { id: info.id }
          state.calls.clear()
        }
        state.message.finish = info.finish
        if (info.error) errored = true
        return
      }
      if (!matches(event, SessionV1.Event.PartUpdated)) return
      const part = event.data.part
      if (part.type !== "tool" || part.messageID !== state.message?.id) return
      const result = action(part)
      if (result === "blocked") blocked = true
      const call = state.calls.get(part.id) ?? { start: ++sequence, settled: false }
      state.calls.set(part.id, call)
      if (call.settled || (part.state.status !== "completed" && part.state.status !== "error")) return
      call.settled = true
      if (result === "failed") failure = ++sequence
      if (result === "success") success = Math.max(success, call.start)
      // A wait is never progress, but it is the last thing to happen in the
      // turn: the loop suspends on it instead of counting it or settling.
      // Record it immediately so a fire during this turn can claim it (D3)
      // even before waiting metadata is written at suspend.
      if (result === "wait") {
        const next = GoalLink.waitFor(part)
        if (next) {
          wait = next
          GoalLink.set(id, next)
        }
      }
    }

    return {
      update,
      dispose: () => {
        open = false
        for (const state of owned.values()) {
          for (const base of state.bases) GoalPolicy.release(base, owner)
        }
      },
      completed: (result: SessionV1.WithParts) =>
        result.info.role === "assistant" &&
        parents.has(result.info.parentID) &&
        !result.info.error &&
        !blocked &&
        success > failure &&
        [...owned.values()].every((state) => state.message?.finish === "stop"),
      blocked: () => blocked,
      failed: () => errored || failure > success,
      report: () => report,
      waiting: () => wait,
    }
  }

  export function make(ops: {
    create: (input: PromptInput) => Effect.Effect<Effect.Effect<SessionV1.WithParts>>
    prompt: (input: PromptInput, ticket: KiloSessionControl.Ticket) => Effect.Effect<SessionV1.WithParts, unknown>
    cancel: (id: SessionID, preserve?: boolean) => Effect.Effect<void>
    control: {
      begin: (
        id: SessionID,
        resume: boolean,
        prior?: KiloSessionControl.Ticket,
      ) => Effect.Effect<KiloSessionControl.Ticket>
    }
  }) {
    return Effect.gen(function* () {
      const sessions = yield* Session.Service
      const commands = yield* Command.Service
      const state = yield* SessionRunState.Service
      const permission = yield* Permission.Service
      const question = yield* Question.Service
      const events = yield* EventV2Bridge.Service
      const drain = yield* SessionDrain.Service
      const scopes = yield* InstanceState.make(() => Scope.Scope)
      const locks = new Map<SessionID, { semaphore: Semaphore.Semaphore; refs: number }>()

      function commit<A, E, R>(id: SessionID, work: Effect.Effect<A, E, R>) {
        return Effect.acquireUseRelease(
          Effect.sync(() => {
            const lock = locks.get(id) ?? { semaphore: Semaphore.makeUnsafe(1), refs: 0 }
            lock.refs++
            locks.set(id, lock)
            return lock
          }),
          (lock) => lock.semaphore.withPermits(1)(work),
          (lock) =>
            Effect.sync(() => {
              if (--lock.refs === 0) locks.delete(id)
            }),
        )
      }

      const pause = Effect.fn("Goal.pause")(function* (id: SessionID, preserve = false) {
        yield* ensure()
        // A waiting goal holds no run token but must still settle to paused and
        // release its timers, so read the hold before dropping it.
        const held = GoalState.hold(id)
        GoalState.pause(id, preserve)
        if (!held) return
        yield* commit(
          id,
          Effect.gen(function* () {
            const session = yield* sessions.get(id).pipe(Effect.orDie)
            const goal = GoalState.read(session.metadata)
            if (!goal) return
            yield* sessions.setMetadata({
              sessionID: id,
              metadata: {
                ...session.metadata,
                "kilo.goal": {
                  text: goal.text,
                  status: "paused",
                  active: false,
                  ...(goal.reason ? { reason: goal.reason } : {}),
                },
              },
            })
            // Clear the wait record before cancelling: the wakeup side's cancel
            // notification must not re-resume the goal this teardown ends.
            GoalLink.clear(id)
            yield* GoalLink.cleanup(id)
          }),
        )
      })

      const pendingFamily = Effect.fn("Goal.pendingFamily")(function* (id: SessionID) {
        const pending = [
          ...(yield* permission.list()),
          ...(yield* question.list()),
          ...(yield* Effect.promise(() => Suggestion.list())),
        ]
        const family = new Set([id])
        for (const parent of family) {
          for (const child of yield* sessions.children(parent)) family.add(child.id)
        }
        return pending.some((request) => family.has(request.sessionID))
      })

      const drive = Effect.fn("Goal.drive")(function* (input: {
        id: SessionID
        text: string
        agent: string
        model: RunModel
        snapshotInitialization?: "wait"
        note?: string
        current: () => boolean
        ticket: KiloSessionControl.Ticket
        cancelled: Effect.Effect<never>
      }) {
        const bridge = yield* EffectBridge.make()
        const scope = yield* InstanceState.get(scopes)
        const guard = {
          current: () => input.current() && input.ticket.current(),
          running: () => input.current() && input.ticket.running(),
        }
        // A recurring task keeps firing after it resumed the goal, so the goal
        // re-suspends on it at the end of each resumed turn.
        const resumeWait = GoalState.read((yield* sessions.get(input.id).pipe(Effect.orDie)).metadata)?.wait
        const settle = (status: GoalState.Status, reason: string) =>
          commit(
            input.id,
            Effect.gen(function* () {
              const session = yield* sessions.get(input.id).pipe(Effect.orDie)
              if (!guard.running()) return
              if (status !== "active") GoalState.pause(input.id, true)
              yield* sessions.setMetadata({
                sessionID: input.id,
                metadata: {
                  ...session.metadata,
                  "kilo.goal": { text: input.text, status, active: status === "active", reason },
                },
              })
              // Clear the wait record before cancelling so the wakeup side's
              // cancel notification cannot re-resume the goal being torn down.
              GoalLink.clear(input.id)
              yield* GoalLink.cleanup(input.id)
            }),
          )
        const suspend = (id: SessionID, text: string, wait: GoalLink.Wait) =>
          commit(
            id,
            Effect.gen(function* () {
              const session = yield* sessions.get(id).pipe(Effect.orDie)
              if (!guard.running()) return
              // Publish the wait before dropping the run token so a fire that
              // arrives during this write can still claim it (D3).
              GoalLink.set(id, wait)
              // Drop the run token before writing: the session metadata mapper
              // projects a goal with a live run token to "active", so only a
              // token-less goal keeps the persisted "waiting" status.
              GoalState.pause(id, true)
              const reason =
                "Waiting for " +
                wait.kind +
                " " +
                wait.id +
                (wait.dueAt ? " until " + new Date(wait.dueAt).toISOString() : "")
              yield* sessions.setMetadata({
                sessionID: id,
                metadata: {
                  ...session.metadata,
                  "kilo.goal": { text, status: "waiting", active: false, reason, wait },
                },
              })
              // Hold the goal so the question gate stays closed while it waits.
              GoalState.markWaiting(id)
              // A process wait outlives the loop fiber, so watch it in the
              // instance scope and resume the goal when the process is gone.
              // The watch stops once this wait is cleared or replaced, so a
              // paused, cleared or replaced goal never restarts itself.
              if (wait.kind === "process") {
                const superseded = Effect.gen(function* () {
                  while (GoalLink.get(id)?.id === wait.id) yield* Effect.sleep("250 millis")
                })
                yield* GoalLink.processWatch(id, wait).pipe(Effect.raceFirst(superseded), Effect.forkIn(scope))
              }
            }),
          )
        type Step = { run: boolean; note?: string }
        // The fired note a resumed or pending fire left for the next goal turn.
        let note = input.note
        const queued = () => {
          const list = GoalLink.takePending(input.id)
          if (!list.length) return undefined
          return { run: true as const, note: list.map((entry) => entry.note).join("\n\n") }
        }
        yield* Effect.gen(function* () {
          while (input.current() && input.ticket.running()) {
            yield* drain.wait(input.id).pipe(Effect.raceFirst(input.cancelled))
            const session = yield* sessions.get(input.id).pipe(Effect.orDie)
            if (!input.current() || !input.ticket.running() || session.time.archived || session.revert) break
            const messageID = MessageID.ascending()
            const step: Step = yield* Effect.gen(function* () {
              const cycle = yield* Effect.acquireRelease(
                Effect.sync(() => outcome(input.id, messageID, guard.running)),
                (cycle) => Effect.sync(cycle.dispose),
              )
              yield* Effect.acquireRelease(
                events.listen((event) =>
                  Effect.sync(() => {
                    if (guard.running()) cycle.update(event)
                  }),
                ),
                (off) => off,
              )
              const result = yield* bridge.run(
                ops.prompt(
                  {
                    sessionID: input.id,
                    messageID,
                    agent: input.agent,
                    model: input.model,
                    variant: input.model.variant,
                    snapshotInitialization: input.snapshotInitialization,
                    parts: [
                      {
                        type: "text",
                        synthetic: true,
                        text: GoalInstructions.prompt(input.text) + (note ? "\n\n" + note : ""),
                      },
                    ],
                  },
                  guard,
                ),
              )
              // A real user prompt preempts this continuation for its turn.
              // Keep the goal active and loop again after the user's turn
              // instead of settling the goal to paused. A blocked or failed
              // goal turn still wins, matching the documented pause rules.
              const preempted = KiloSessionPromptQueue.consumeSuperseded(input.id, messageID)
              yield* drain.wait(input.id).pipe(Effect.raceFirst(input.cancelled))
              if (cycle.blocked()) {
                yield* settle(
                  "blocked",
                  "A request was rejected or execution was blocked. Resolve the blocker before resuming.",
                )
                return { run: false }
              }
              if (cycle.failed() || result.info.role !== "assistant" || result.info.error) {
                yield* settle("paused", "Work failed. Review the conversation before resuming.")
                return { run: false }
              }
              if (preempted) return { run: true }
              // A fire that reached this in-flight turn is carried into the
              // next cycle instead of starting a second run or being dropped
              // by a same-turn complete report (D3).
              const fire = queued()
              if (fire) return fire
              const report = cycle.report()
              if (report && result.info.finish === "stop") {
                const late = queued()
                if (late) return late
                yield* settle(
                  report.status,
                  `Reported by the working model, not independently verified: ${report.reason}`,
                )
                return { run: false }
              }
              // A turn that armed a timer is not progress: suspend on it and
              // run no further goal turn until it fires.
              const wait = cycle.waiting()
              if (wait) {
                const late = queued()
                if (late) return late
                yield* suspend(input.id, input.text, wait)
                const extra = queued()
                if (extra) {
                  yield* GoalLink.arm(input.id, { sessionID: input.id, action: "resume", note: extra.note })
                  return { run: false }
                }
                return { run: false }
              }
              // A recurring task survives the resume it caused, so the goal
              // waits for its next fire too.
              if (resumeWait?.recurring) {
                const late = queued()
                if (late) return late
                yield* suspend(input.id, input.text, resumeWait)
                const extra = queued()
                if (extra) {
                  yield* GoalLink.arm(input.id, { sessionID: input.id, action: "resume", note: extra.note })
                  return { run: false }
                }
                return { run: false }
              }
              const next = cycle.completed(result)
              if (!next)
                yield* settle(
                  "paused",
                  "No successful action or explicit completion report. Review the conversation before resuming.",
                )
              return { run: next }
            }).pipe(Effect.scoped)
            if (!step.run) break
            if (step.note) {
              note = step.note
              continue
            }
            yield* Effect.sleep("5 seconds").pipe(Effect.raceFirst(input.cancelled))
          }
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.gen(function* () {
              if (Cause.hasInterruptsOnly(cause)) return
              yield* settle("paused", "Execution failed. Review the conversation before resuming.")
              yield* Effect.logError("Goal paused", { sessionID: input.id, cause })
              yield* events.publish(Session.Event.Error, {
                sessionID: input.id,
                error: new NamedError.Unknown({ message: "Goal paused after an error." }).toObject(),
              })
            }),
          ),
          Effect.ensuring(Effect.suspend(() => (input.current() ? pause(input.id, true) : Effect.void))),
          Effect.forkIn(scope),
        )
      })

      const command = Effect.fn("Goal.command")(function* (input: CommandInput) {
        yield* ensure()
        const id = input.sessionID
        const args = input.arguments.trim()
        // The composer uses a delimiter so objectives can also be control words.
        const objective = args.startsWith("-- ") ? args.slice(3).trim() : undefined
        const starting = args !== "" && args !== "pause" && args !== "clear"
        const stopped = Deferred.makeUnsafe<void>()
        const end = () => Deferred.doneUnsafe(stopped, Effect.void)
        const cancelled = Deferred.await(stopped).pipe(Effect.andThen(Effect.interrupt))
        const intent = args ? GoalState.prepare(id, end) : undefined
        return yield* Effect.gen(function* () {
          yield* commands.get("goal")
          const session = yield* sessions.get(id).pipe(Effect.orDie)
          const saved = GoalState.read(session.metadata)
          const text = objective ?? (args === "resume" ? saved?.text : starting ? args : saved?.text)
          if (starting && !text) return yield* Effect.fail(new Error("Set a goal with /goal <objective> first."))
          if (text && text.length > 10_000)
            return yield* Effect.fail(new Error("Keep the goal under 10,000 characters."))
          const admit = (replace: boolean) =>
            Effect.gen(function* () {
              const session = yield* sessions.get(id).pipe(Effect.orDie)
              if (session.time.archived || session.revert) {
                yield* Effect.fail(new Error("Restore this session before starting a goal."))
              }
              if (!replace || (!starting && !GoalState.active(id)))
                yield* state
                  .assertNotBusy(id)
                  .pipe(Effect.mapError(() => new Error("Stop the current response before starting a goal.")))
              if (yield* pendingFamily(id)) {
                yield* Effect.fail(new Error("Resolve pending questions and permissions before starting a goal."))
              }
            })
          if (starting) yield* admit(true)
          if (intent && !intent.current()) return yield* Effect.interrupt
          // Resolve attachments without changing the transcript, model, or running goal.
          const prepared = starting
            ? yield* KiloSessionPrompt.intake(
                id,
                ops
                  .create({
                    sessionID: id,
                    messageID: input.messageID,
                    agent: input.agent,
                    model: input.model ? Provider.parseModel(input.model) : undefined,
                    variant: input.variant,
                    parts: [
                      { type: "text", text: `/goal ${objective ?? args}`, ignored: true },
                      ...(input.parts ?? []),
                    ],
                  })
                  .pipe(Effect.raceFirst(cancelled)),
              )
            : undefined
          if (starting) yield* admit(true)
          if (intent && !intent.current()) return yield* Effect.interrupt
          if (GoalState.active(id)) yield* ops.cancel(id, true)
          if (starting) {
            const busy = yield* Effect.exit(state.assertNotBusy(id))
            if (Exit.isFailure(busy)) yield* ops.cancel(id, true)
          }
          if (intent && !intent.current()) return yield* Effect.interrupt
          if (args === "pause" || args === "clear") yield* pause(id, true)
          const prior = yield* ops.control.begin(id, false)
          if (starting) yield* admit(false)
          if (intent && !intent.current()) return yield* Effect.interrupt
          const ticket = starting ? yield* ops.control.begin(id, true, prior) : prior
          if (!ticket.current() || (intent && !intent.current())) return yield* Effect.interrupt
          // A held goal (active or waiting) is the one a new objective replaces,
          // and its timers must go with it.
          const wasHeld = GoalState.hold(id)
          const current = starting ? GoalState.start(id, end) : undefined
          if (starting && args !== "resume" && text && GoalInstructions.timed(text)) GoalState.curb(id)
          // The wakeup side resumes this goal through the registered handler.
          if (starting) GoalLink.registerArm(id, (next) => arm({ sessionID: id, action: next.action, note: next.note }))
          const valid = () => ticket.current() && (!intent || intent.current()) && (!current || current())
          let started = false
          const work = Effect.gen(function* () {
            if (starting || args === "clear") {
              yield* commit(
                id,
                Effect.gen(function* () {
                  const fresh = yield* sessions.get(id).pipe(Effect.orDie)
                  if (!valid()) return yield* Effect.interrupt
                  const metadata = { ...fresh.metadata }
                  if (starting) {
                    // Only a resume keeps the wait a recurring task needs; a new
                    // objective must not inherit the replaced goal's timer.
                    const resumeWait = args === "resume" ? GoalState.read(fresh.metadata)?.wait : undefined
                    if (wasHeld && !resumeWait) {
                      // The replaced goal's timers go with it, so its fire cannot
                      // resume a goal it no longer belongs to.
                      GoalLink.clear(id)
                      yield* GoalLink.cleanup(id)
                    }
                    metadata["kilo.goal"] = {
                      text,
                      status: "active",
                      active: true,
                      ...(resumeWait ? { wait: resumeWait } : {}),
                    }
                  }
                  if (args === "clear") delete metadata["kilo.goal"]
                  return yield* sessions.setMetadata({ sessionID: id, metadata })
                }),
              )
            }
            const notice = !args
              ? `${text ? `Goal ${saved?.status}: ${text}\n${saved?.reason ?? ""}\n` : ""}${GoalInstructions.help}`
              : args === "clear"
                ? "Goal cleared. Cancelled the armed wakeups and cron tasks."
                : starting
                  ? "Goal active. The working model reports completion or blockers with goal_report; completion is not independently verified. No progress or errors pause the goal. Use Stop or /goal pause to pause."
                  : "Goal paused. Cancelled the armed wakeups and cron tasks. Use /goal resume to continue."
            const user = prepared ? (yield* prepared).info : undefined
            if (user && user.role !== "user") return yield* Effect.die(new Error("Expected a user message"))
            if (!valid()) return yield* Effect.interrupt
            const { model, agent } = runTarget(session, user)
            const ctx = yield* InstanceState.context
            const now = Date.now()
            const info: SessionV1.Assistant = {
              id: MessageID.ascending(),
              sessionID: id,
              parentID: user?.id ?? input.messageID ?? MessageID.ascending(),
              role: "assistant",
              mode: agent,
              agent,
              providerID: model.providerID,
              modelID: model.modelID,
              variant: model.variant,
              path: { cwd: ctx.directory, root: ctx.worktree },
              cost: 0,
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              time: { created: now, completed: now },
              finish: "stop",
            }
            const part: SessionV1.TextPart = {
              id: PartID.ascending(),
              messageID: info.id,
              sessionID: id,
              type: "text",
              text: notice,
            }
            if (starting) {
              if (!valid()) return yield* Effect.interrupt
              yield* sessions.updateMessage(info)
              yield* sessions.updatePart(part)
            }
            yield* events.publish(Command.Event.Executed, {
              name: "goal",
              sessionID: id,
              arguments: input.arguments,
              messageID: info.id,
            })

            if (current && text && current()) {
              yield* drive({
                id,
                text,
                agent,
                model,
                snapshotInitialization: input.snapshotInitialization,
                current,
                ticket,
                cancelled,
              })
              started = true
            }
            return { info, parts: [part] }
          })
          return yield* (
            starting
              ? KiloSessionPrompt.intake(
                  id,
                  Effect.suspend(() => (valid() ? work : Effect.interrupt)),
                )
              : work
          ).pipe(
            (work) => (intent ? work.pipe(Effect.raceFirst(cancelled)) : work),
            Effect.ensuring(Effect.suspend(() => (!started && current?.() ? pause(id, true) : Effect.void))),
          )
        }).pipe(Effect.ensuring(Effect.sync(() => intent?.release())))
      })

      // Agent-facing goal control. Unlike the /goal command, this does not cancel
      // the current turn: it arms the goal and lets the loop continue after the
      // turn drains, so the model can start or resume a goal itself.
      const arm = Effect.fn("Goal.arm")(function* (input: ArmInput) {
        yield* ensure()
        const id = input.sessionID
        const session = yield* sessions.get(id).pipe(Effect.orDie)
        if (session.parentID) {
          return yield* Effect.fail(new Error("Start goals from the main session, not a delegated session."))
        }
        if (session.time.archived || session.revert) {
          return yield* Effect.fail(new Error("Restore this session before starting a goal."))
        }
        if (GoalState.active(id)) {
          return yield* Effect.fail(new Error("A goal is already active. Pause or clear it before starting another."))
        }
        const saved = GoalState.read(session.metadata)
        const text = input.action === "resume" ? saved?.text : input.objective?.trim()
        if (!text) {
          return yield* Effect.fail(
            new Error(
              input.action === "resume" ? "There is no saved goal to resume." : "Provide an objective to start a goal.",
            ),
          )
        }
        if (text.length > 10_000) return yield* Effect.fail(new Error("Keep the goal under 10,000 characters."))
        if (yield* pendingFamily(id)) {
          return yield* Effect.fail(new Error("Resolve pending questions and permissions before starting a goal."))
        }
        const stopped = Deferred.makeUnsafe<void>()
        const end = () => Deferred.doneUnsafe(stopped, Effect.void)
        const cancelled = Deferred.await(stopped).pipe(Effect.andThen(Effect.interrupt))
        // Claim the arm so concurrent starts serialize; a later claim cancels this one.
        const claim = GoalState.prepare(id, end)
        const { model, agent } = runTarget(session)
        return yield* Effect.gen(function* () {
          const ticket = yield* ops.control.begin(id, true)
          if (!claim.current() || !ticket.current()) return yield* Effect.interrupt
          // A held goal (active or waiting) is the one a new objective replaces,
          // and its timers must go with it.
          const wasHeld = GoalState.hold(id)
          const current = GoalState.start(id, end)
          if (input.action !== "resume" && !input.note && GoalInstructions.timed(text)) GoalState.curb(id)
          // The wakeup side resumes this goal through the registered handler.
          GoalLink.registerArm(id, (next) => arm({ sessionID: id, action: next.action, note: next.note }))
          const valid = () => claim.current() && current() && ticket.current()
          const body = Effect.gen(function* () {
            yield* commit(
              id,
              Effect.gen(function* () {
                const fresh = yield* sessions.get(id).pipe(Effect.orDie)
                if (!valid()) return yield* Effect.interrupt
                // Only a resume keeps the wait a recurring task needs; a new
                // objective must not inherit the replaced goal's timer.
                const resumeWait = input.action === "resume" ? GoalState.read(fresh.metadata)?.wait : undefined
                if (wasHeld && !resumeWait) {
                  // The replaced goal's timers go with it, so its fire cannot
                  // resume a goal it no longer belongs to.
                  GoalLink.clear(id)
                  yield* GoalLink.cleanup(id)
                }
                yield* sessions.setMetadata({
                  sessionID: id,
                  metadata: {
                    ...fresh.metadata,
                    "kilo.goal": {
                      text,
                      status: "active",
                      active: true,
                      ...(resumeWait ? { wait: resumeWait } : {}),
                    },
                  },
                })
              }),
            )
            yield* drive({
              id,
              text,
              agent,
              model,
              snapshotInitialization: input.snapshotInitialization,
              note: input.note,
              current,
              ticket,
              cancelled,
            })
            return { text }
          })
          return yield* body.pipe(
            Effect.onExit((exit) =>
              Exit.isSuccess(exit) ? Effect.void : Effect.suspend(() => (current() ? pause(id, true) : Effect.void)),
            ),
          )
        }).pipe(Effect.ensuring(Effect.sync(() => claim.release())))
      })

      const factory: GoalLink.Arm = (next) => arm({ sessionID: next.sessionID, action: next.action, note: next.note })
      const ensure = Effect.fn("Goal.ensure")(function* () {
        const ctx = yield* InstanceRef
        if (!ctx) return
        GoalLink.bind(ctx.directory, factory)
        for (const session of yield* sessions.list()) {
          GoalLink.hydrate(session.id, session.metadata, factory)
        }
      })
      GoalLink.bind("", factory)
      yield* ensure()

      return { command, pause, arm }
    })
  }
}
