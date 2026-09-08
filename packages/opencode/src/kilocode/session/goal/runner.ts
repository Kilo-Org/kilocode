import { Cause, Deferred, Effect, Scope, Semaphore } from "effect"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { NamedError } from "@opencode-ai/core/util/error"
import type { EventV2 } from "@opencode-ai/core/event"
import { Interrupted } from "@opencode-ai/schema/kilocode/session-drain"
import { Command } from "@/command"
import { EffectBridge } from "@/effect/bridge"
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
import { GoalPolicy } from "./policy"
import { GoalInstructions } from "./instructions"
import { SessionDrain } from "../drain"
import { KiloSessionPrompt } from "../prompt"
import { KiloSessionPromptQueue } from "../prompt-queue"
import { isRecord } from "@/util/record"

export namespace Goal {
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
        if (!GoalState.pause(id, preserve)) return
        yield* commit(
          id,
          Effect.gen(function* () {
            const session = yield* sessions.get(id).pipe(Effect.orDie)
            const goal = GoalState.read(session.metadata)
            if (!goal) return
            yield* sessions.setMetadata({
              sessionID: id,
              metadata: { ...session.metadata, "kilo.goal": { ...goal, status: "paused", active: false } },
            })
          }),
        )
      })

      const command = Effect.fn("Goal.command")(function* (input: CommandInput) {
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
              if (!replace || !GoalState.active(id))
                yield* state
                  .assertNotBusy(id)
                  .pipe(Effect.mapError(() => new Error("Stop the current response before starting a goal.")))
              const pending = [
                ...(yield* permission.list()),
                ...(yield* question.list()),
                ...(yield* Effect.promise(() => Suggestion.list())),
              ]
              const family = new Set([id])
              for (const parent of family) {
                for (const child of yield* sessions.children(parent)) family.add(child.id)
              }
              if (pending.some((request) => family.has(request.sessionID))) {
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
          if (args && GoalState.active(id)) yield* ops.cancel(id, true)
          if (intent && !intent.current()) return yield* Effect.interrupt
          if (args === "pause" || args === "clear") yield* pause(id, true)
          const prior = yield* ops.control.begin(id, false)
          if (starting) yield* admit(false)
          if (intent && !intent.current()) return yield* Effect.interrupt
          const ticket = starting ? yield* ops.control.begin(id, true, prior) : prior
          if (!ticket.current() || (intent && !intent.current())) return yield* Effect.interrupt
          const current = starting ? GoalState.start(id, end) : undefined
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
                  if (starting) metadata["kilo.goal"] = { text, status: "active", active: true }
                  if (args === "clear") delete metadata["kilo.goal"]
                  return yield* sessions.setMetadata({ sessionID: id, metadata })
                }),
              )
            }
            const notice = !args
              ? `${text ? `Goal ${saved?.status}: ${text}\n${saved?.reason ?? ""}\n` : ""}${GoalInstructions.help}`
              : args === "clear"
                ? "Goal cleared."
                : starting
                  ? "Goal active. Work uses model credits. The working model reports completion or blockers with goal_report; completion is not independently verified. No progress or errors pause the goal. Use Stop or /goal pause to pause."
                  : "Goal paused. Use /goal resume to continue."
            const user = prepared ? (yield* prepared).info : undefined
            if (user && user.role !== "user") return yield* Effect.die(new Error("Expected a user message"))
            if (!valid()) return yield* Effect.interrupt
            const model =
              user?.model ??
              (session.model
                ? { providerID: session.model.providerID, modelID: session.model.id, variant: session.model.variant }
                : { ...Provider.parseModel("local/goal"), variant: undefined })
            const agent = user?.agent ?? session.agent ?? "code"
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
              const bridge = yield* EffectBridge.make()
              const scope = yield* InstanceState.get(scopes)
              const guard = {
                current: () => current() && ticket.current(),
                running: () => current() && ticket.running(),
              }
              const settle = (status: GoalState.Status, reason: string) =>
                commit(
                  id,
                  Effect.gen(function* () {
                    const session = yield* sessions.get(id).pipe(Effect.orDie)
                    if (!guard.running()) return
                    if (status !== "active") GoalState.pause(id, true)
                    yield* sessions.setMetadata({
                      sessionID: id,
                      metadata: {
                        ...session.metadata,
                        "kilo.goal": { text, status, active: status === "active", reason },
                      },
                    })
                  }),
                )
              yield* Effect.gen(function* () {
                while (current() && ticket.running()) {
                  yield* drain.wait(id).pipe(Effect.raceFirst(cancelled))
                  const session = yield* sessions.get(id).pipe(Effect.orDie)
                  if (!current() || !ticket.running() || session.time.archived || session.revert) break
                  const messageID = MessageID.ascending()
                  const next = yield* Effect.gen(function* () {
                    const cycle = yield* Effect.acquireRelease(
                      Effect.sync(() => outcome(id, messageID, guard.running)),
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
                          sessionID: id,
                          messageID,
                          agent,
                          model,
                          variant: model.variant,
                          snapshotInitialization: input.snapshotInitialization,
                          parts: [
                            {
                              type: "text",
                              synthetic: true,
                              text: GoalInstructions.prompt(text),
                            },
                          ],
                        },
                        guard,
                      ),
                    )
                    yield* drain.wait(id).pipe(Effect.raceFirst(cancelled))
                    if (cycle.blocked()) {
                      yield* settle(
                        "blocked",
                        "A request was rejected or execution was blocked. Resolve the blocker before resuming.",
                      )
                      return false
                    }
                    if (cycle.failed() || result.info.role !== "assistant" || result.info.error) {
                      yield* settle("paused", "Work failed. Review the conversation before resuming.")
                      return false
                    }
                    const report = cycle.report()
                    if (report && result.info.finish === "stop") {
                      yield* settle(
                        report.status,
                        `Reported by the working model, not independently verified: ${report.reason}`,
                      )
                      return false
                    }
                    const next = cycle.completed(result)
                    if (!next)
                      yield* settle(
                        "paused",
                        "No successful action or explicit completion report. Review the conversation before resuming.",
                      )
                    return next
                  }).pipe(Effect.scoped)
                  if (!next) break
                  yield* Effect.sleep("5 seconds").pipe(Effect.raceFirst(cancelled))
                }
              }).pipe(
                Effect.catchCause((cause) =>
                  Effect.gen(function* () {
                    if (Cause.hasInterruptsOnly(cause)) return
                    yield* settle("paused", "Execution failed. Review the conversation before resuming.")
                    yield* Effect.logError("Goal paused", { sessionID: id, cause })
                    yield* events.publish(Session.Event.Error, {
                      sessionID: id,
                      error: new NamedError.Unknown({ message: "Goal paused after an error." }).toObject(),
                    })
                  }),
                ),
                Effect.ensuring(Effect.suspend(() => (current() ? pause(id, true) : Effect.void))),
                Effect.forkIn(scope),
              )
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
      return { command, pause }
    })
  }
}
