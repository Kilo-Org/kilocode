import { ToolFailure } from "@opencode/ai/effect"
import { define } from "@opencode/plugin/effect/plugin"
import { KiloGoalRpc } from "@opencode/schema/kilocode/goal"
import type { Session } from "@opencode/schema/session"
import type { SessionMessage } from "@opencode/schema/session-message"
import { Effect, Schema, Semaphore, Stream } from "effect"
import { GoalInstructions } from "./instructions"
import { blocked, evaluate } from "./progress"
import { boot, defined, describe, help, MAX_OBJECTIVE, parse, PREFIX, read, visible, type Stored } from "./state"

const Report = Schema.Struct({
  status: Schema.Literals(["complete", "blocked"]),
  reason: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2_000)),
})

const Control = Schema.Struct({
  action: Schema.Literals(["start", "resume"]).annotate({
    description: "start a new goal with an objective, or resume the saved goal.",
  }),
  objective: Schema.optional(
    Schema.String.annotate({ description: "The objective for action start. Ignored for action resume." }),
  ),
})

const ControlOutput = Schema.Struct({
  status: Schema.Literal("active"),
  objective: Schema.String,
})

const ReportOutput = Schema.Struct({
  status: Schema.Literals(["complete", "blocked"]),
  reason: Schema.String,
})

const CONTROL = "goal"
const REPORT = "goal_report"
const PREFIX_KEY = PREFIX

type Recorded = { readonly goalID: string; readonly messageID: SessionMessage.ID; readonly status: "complete" | "blocked"; readonly reason: string }

/**
 * The Kilo session goal: one objective that keeps a session working across turns. The loop is a stop hook on the
 * session idle boundary. The working model reports completion or a blocker with `goal_report`; a turn without a
 * successful action, a failed step, or a rejected request pauses the goal instead of looping.
 *
 * The goal is the plugin's own storage, so children and forks start without one, and clients read it through the
 * `kilocode.goal` RPC.
 */
export const KiloGoalPlugin = define({
  id: "kilocode.goal",
  effect: Effect.fn("KiloGoal.Plugin")(function* (ctx) {
    const reports = new Map<string, Recorded>()
    // Sessions whose current turn belongs to the goal loop. The goal tool refuses to re-arm while one runs, as v1
    // refused control from the current Goal worker; the command path stays available to the user.
    const running = new Set<string>()
    const locks = new Map<string, Semaphore.Semaphore>()

    const lock = (sessionID: string) => {
      const found = locks.get(sessionID)
      if (found) return found
      const created = Semaphore.makeUnsafe(1)
      locks.set(sessionID, created)
      return created
    }

    const exclusive = <A, E, R>(sessionID: string, work: Effect.Effect<A, E, R>) =>
      Effect.acquireUseRelease(
        Effect.sync(() => lock(sessionID)),
        (semaphore) => semaphore.withPermits(1)(work),
        () => Effect.void,
      )

    const readStored = Effect.fn("KiloGoal.read")(function* (sessionID: string) {
      return read(yield* ctx.storage.get(PREFIX_KEY + sessionID))
    })

    const rpc = yield* ctx.rpc
      .register(KiloGoalRpc.Definition, {
        get: (input) =>
          readStored(input.sessionID).pipe(Effect.map((goal) => (goal ? visible(goal) : null))),
      })
      .pipe(Effect.orDie)

    const changed = (sessionID: string, goal: Stored | undefined) =>
      rpc.events
        .emit("changed", { sessionID, goal: goal ? defined(visible(goal)) : null })
        .pipe(Effect.catchCause((cause) => Effect.logWarning("failed to publish a goal change", { sessionID, cause })))

    const write = Effect.fn("KiloGoal.write")(function* (sessionID: string, goal: Stored | undefined) {
      yield* goal
        ? ctx.storage.set(PREFIX_KEY + sessionID, defined(goal))
        : ctx.storage.remove(PREFIX_KEY + sessionID)
      yield* changed(sessionID, goal)
    })

    // A late result must not overwrite a newer decision, such as a user pause. Only the listed statuses settle.
    const settle = Effect.fn("KiloGoal.settle")(function* (
      sessionID: string,
      status: "complete" | "blocked" | "paused",
      reason: string,
      from: ReadonlyArray<KiloGoalRpc.Status> = ["active", "waiting"],
    ) {
      return yield* exclusive(
        sessionID,
        Effect.gen(function* () {
          const goal = yield* readStored(sessionID)
          if (!goal || !from.includes(goal.status)) return false
          yield* write(sessionID, { ...goal, status, reason, wait: undefined, updatedAt: Date.now() })
          reports.delete(sessionID)
          return true
        }),
      )
    })

    const waiting = Effect.fn("KiloGoal.waiting")(function* (
      sessionID: string,
      goal: Stored,
      wait: KiloGoalRpc.Wait,
    ) {
      return yield* exclusive(
        sessionID,
        Effect.gen(function* () {
          const current = yield* readStored(sessionID)
          if (!current || current.id !== goal.id || current.status !== goal.status) return false
          yield* write(sessionID, {
            ...current,
            status: "waiting",
            wait,
            reason: `Waiting for background work: ${wait.label}`,
            updatedAt: Date.now(),
          })
          return true
        }),
      )
    })

    const continueGoal = (sessionID: Session.ID, text: string, goalID: string, kind: "prompt" | "kickoff" | "resumed") => {
      running.add(sessionID)
      return ctx.session.synthetic({
        sessionID,
        text:
          kind === "kickoff"
            ? GoalInstructions.kickoff(text)
            : kind === "resumed"
              ? GoalInstructions.resumed(text)
              : GoalInstructions.prompt(text),
        description: `Goal: ${truncate(text, 120)}`,
        metadata: { source: "goal", goalID },
      })
    }

    // A goal stored by an earlier process is paused: nothing drives it until the model or the user resumes it.
    yield* Effect.gen(function* () {
      let after: string | undefined
      do {
        const page = yield* ctx.storage.scan({ prefix: PREFIX_KEY, after, limit: 100 })
        yield* Effect.forEach(
          page.entries,
          (entry) => {
            const goal = read(entry.value)
            if (!goal || goal.status !== "active" || goal.boot === boot()) return Effect.void
            const sessionID = entry.key.slice(PREFIX_KEY.length)
            return settle(sessionID, "paused", "The server restarted while the goal was active", ["active"])
          },
          { discard: true },
        )
        after = page.next
      } while (after !== undefined)
    }).pipe(
      Effect.catchCause((cause) => Effect.logWarning("failed to pause goals left by an earlier process", { cause })),
      Effect.forkScoped({ startImmediately: true }),
    )

    yield* ctx.event
      .subscribe({ types: ["session.execution.failed", "session.execution.interrupted", "session.deleted"] })
      .pipe(
        Stream.runForEach((event) => {
          const sessionID = event.data.sessionID
          if (event.type === "session.deleted") {
            reports.delete(sessionID)
            running.delete(sessionID)
            return ctx.storage.remove(PREFIX_KEY + sessionID).pipe(Effect.ignore)
          }
          // Shutdown keeps the goal active; the next process sees the boot change and pauses it.
          if (event.type === "session.execution.interrupted" && event.data.reason === "shutdown") return Effect.void
          running.delete(sessionID)
          const reason =
            event.type === "session.execution.failed"
              ? `The session failed: ${event.data.error.message}`
              : "Stopped by the user"
          return settle(sessionID, "paused", reason).pipe(Effect.asVoid)
        }),
        Effect.catchCause((cause) => Effect.logWarning("failed to watch goal executions", { cause })),
        Effect.forkScoped({ startImmediately: true }),
      )

    // The stop hook: the session has no pending input and is about to go idle. Input admitted here continues the
    // same execution, so the goal runs without a second concurrent prompt.
    yield* ctx.session.hook("experimental.idle", (event) =>
      Effect.gen(function* () {
        const sessionID = event.sessionID
        const goal = yield* readStored(sessionID)
        if (!goal || goal.status === "complete" || goal.status === "blocked" || goal.status === "paused") {
          running.delete(sessionID)
          return
        }
        if (goal.status === "active" && goal.boot !== boot()) {
          yield* settle(sessionID, "paused", "The server restarted while the goal was active")
          running.delete(sessionID)
          return
        }
        const background = event.background.filter((work) => work.sessionID === sessionID)
        if (background.length > 0) {
          const work = background[0]!
          const wait: KiloGoalRpc.Wait = {
            kind: "process",
            id: work.kind === "shell" ? work.shellID : work.kind === "subagent" ? work.childSessionID : work.path,
            label: work.kind === "shell" ? work.command : work.kind === "subagent" ? work.description : work.model,
          }
          if (goal.wait?.id !== wait.id) yield* waiting(sessionID, goal, wait)
          return
        }
        const messages = yield* ctx.session.context({ sessionID })
        const progress = evaluate(messages, goal.id)
        const report = reports.get(sessionID)
        if (report && report.goalID === goal.id && progress.assistants.has(report.messageID)) {
          yield* settle(
            sessionID,
            report.status,
            `Reported by the working model, not independently verified: ${report.reason}`,
          )
          running.delete(sessionID)
          return
        }
        const stop = blocked(progress)
        if (stop) {
          yield* settle(sessionID, "paused", stop)
          running.delete(sessionID)
          return
        }
        // Recheck under the lock: a pause or clear may land between the read above and this continuation.
        const live = yield* exclusive(
          sessionID,
          Effect.gen(function* () {
            const current = yield* readStored(sessionID)
            if (!current || current.id !== goal.id) return false
            if (current.status !== "active" && current.status !== "waiting") return false
            yield* write(sessionID, { ...current, status: "active", reason: undefined, wait: undefined, updatedAt: Date.now() })
            return true
          }),
        )
        if (live) yield* continueGoal(sessionID, goal.text, goal.id, "prompt")
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("goal continuation failed", { sessionID: event.sessionID, cause }).pipe(
            Effect.andThen(settle(event.sessionID, "paused", "The goal stopped after an error")),
            Effect.asVoid,
          ),
        ),
      ),
    )

    // During active goal execution the question tool is unavailable, as the goal prompt tells the model.
    yield* ctx.tool.hook("execute.before", (event) =>
      event.tool === "question"
        ? readStored(event.sessionID).pipe(
            Effect.flatMap((goal) =>
              goal && (goal.status === "active" || goal.status === "waiting")
                ? Effect.fail(new ToolFailure({ message: "The question tool is unavailable during active goal execution." }))
                : Effect.void,
            ),
          )
        : Effect.void,
    )

    yield* ctx.tool.transform((editor) => {
      editor.add({
        name: CONTROL,
        options: { codemode: false },
        description:
          "Start or resume a session Goal so you keep working toward one objective across turns. Use action start with an objective, or action resume to continue a saved goal that is paused, blocked, or complete. The goal becomes active and the goal loop continues automatically after this turn. Do not keep working in this turn; give a short final response and report the outcome later with goal_report. Completion is your report, not independent verification. This tool does not grant permission or change scope.",
        input: Control,
        output: ControlOutput,
        execute: (input, context) =>
          Effect.gen(function* () {
            const goal = yield* readStored(context.sessionID)
            if (running.has(context.sessionID))
              return yield* Effect.fail(
                new ToolFailure({ message: "Goal control rejected: the goal turn is still running." }),
              )
            if (goal && (goal.status === "active" || goal.status === "waiting"))
              return yield* Effect.fail(
                new ToolFailure({ message: "Goal control rejected: a goal is already active." }),
              )
            yield* ctx.permission.assert({
              action: CONTROL,
              resources: [input.action],
              save: ["*"],
              sessionID: context.sessionID,
              agent: context.agent,
              metadata: { action: input.action, objective: input.objective },
              source: { type: "tool", messageID: context.messageID, id: context.id },
            })
            const session = yield* ctx.session.get({ sessionID: context.sessionID })
            if (session.parentID)
              return yield* Effect.fail(
                new ToolFailure({ message: "Start goals from the main session, not a delegated session." }),
              )
            const text = input.action === "resume" ? goal?.text : input.objective?.trim()
            if (!text)
              return yield* Effect.fail(
                new ToolFailure({
                  message:
                    input.action === "resume"
                      ? "There is no saved goal to resume."
                      : "Provide an objective to start a goal.",
                }),
              )
            if (text.length > MAX_OBJECTIVE)
              return yield* Effect.fail(
                new ToolFailure({ message: `Keep the goal under ${MAX_OBJECTIVE} characters.` }),
              )
            const next: Stored = {
              id: goal?.id ?? crypto.randomUUID(),
              text,
              status: "active",
              updatedAt: Date.now(),
              boot: boot(),
            }
            yield* exclusive(context.sessionID, write(context.sessionID, next))
            return {
              output: { status: "active" as const, objective: text },
              content: `Goal active: ${text}\nDo not continue this turn. Give a short final response; the goal loop continues automatically after this turn. Report completion or a blocker later with goal_report.`,
              metadata: { action: input.action, objective: text },
            }
          }).pipe(Effect.mapError(goalError)),
      })

      editor.add({
        name: REPORT,
        options: { codemode: false },
        description:
          "Report this active Goal as complete or blocked, with a concrete reason based on your work. This is your report, not independent verification. Only the Goal's root worker may report. A scheduled wait is not a blocker: when background work can carry the goal forward, the goal suspends until it finishes instead of ending. Report blocked only when no scheduled wait can help. Report after finishing work, then give your final response without further actions. The report is saved after the turn finishes; Stop, errors, or a replaced goal can invalidate it. This tool does not grant permission or change scope.",
        input: Report,
        output: ReportOutput,
        execute: (input, context) =>
          Effect.gen(function* () {
            const reason = input.reason.trim()
            const goal = yield* readStored(context.sessionID)
            if (!reason || !goal || (goal.status !== "active" && goal.status !== "waiting"))
              return yield* Effect.fail(
                new ToolFailure({ message: "Goal report rejected: no active root Goal execution." }),
              )
            yield* ctx.permission.assert({
              action: REPORT,
              resources: [input.status],
              save: ["*"],
              sessionID: context.sessionID,
              agent: context.agent,
              metadata: { status: input.status, reason },
              source: { type: "tool", messageID: context.messageID, id: context.id },
            })
            reports.set(context.sessionID, {
              goalID: goal.id,
              messageID: context.messageID,
              status: input.status,
              reason,
            })
            return {
              output: { status: input.status, reason },
              content:
                "Report recorded for this turn. Give your final response now. The Goal state is saved only if this execution remains current and finishes without an error or rejected request.",
              metadata: { status: input.status, reason },
            }
          }).pipe(Effect.mapError(goalError)),
      })
    })

    yield* ctx.command.transform((editor) => {
      editor.add({
        name: CONTROL,
        description: "keep working until an objective is met [pause|resume|clear]",
        execute: (input) =>
          Effect.gen(function* () {
            const sessionID = input.sessionID
            const command = parse(input.prompt.text)
            const goal = yield* readStored(sessionID)
            const session = yield* ctx.session.get({ sessionID })
            if (command.kind === "status") {
              return yield* Effect.fail(new Error(goal ? `${describe(visible(goal))}\n${help}` : help))
            }
            if (command.kind === "pause") {
              if (!goal || (goal.status !== "active" && goal.status !== "waiting"))
                return yield* Effect.fail(new Error("No active goal to pause."))
              yield* settle(sessionID, "paused", "Paused by the user")
              return
            }
            if (command.kind === "clear") {
              if (!goal) return yield* Effect.fail(new Error("No goal is set."))
              reports.delete(sessionID)
              running.delete(sessionID)
              return yield* exclusive(sessionID, write(sessionID, undefined))
            }
            if (session.parentID)
              return yield* Effect.fail(
                new Error("Start goals from the main session, not a delegated session."),
              )
            if (session.time.archived || session.revert)
              return yield* Effect.fail(new Error("Restore this session before starting a goal."))
            const text = command.kind === "resume" ? goal?.text : command.text
            if (!text)
              return yield* Effect.fail(
                new Error(command.kind === "resume" ? "There is no saved goal to resume." : "Set a goal with /goal <objective> first."),
              )
            if (text.length > MAX_OBJECTIVE)
              return yield* Effect.fail(new Error(`Keep the goal under ${MAX_OBJECTIVE} characters.`))
            if (command.kind === "start" && goal && (goal.status === "active" || goal.status === "waiting"))
              return yield* Effect.fail(
                new Error("A goal is already active. Pause or clear it before starting another."),
              )
            const next: Stored = {
              id: command.kind === "resume" ? (goal?.id ?? crypto.randomUUID()) : crypto.randomUUID(),
              text,
              status: "active",
              updatedAt: Date.now(),
              boot: boot(),
            }
            yield* exclusive(sessionID, write(sessionID, next))
            yield* continueGoal(
              sessionID,
              text,
              next.id,
              command.kind === "resume" ? "resumed" : "kickoff",
            )
          }),
      })
    })
  }),
})

function goalError(error: unknown) {
  if (error instanceof ToolFailure) return error
  return new ToolFailure({ message: error instanceof Error ? error.message : String(error), error })
}

function truncate(text: string, length: number) {
  const line = text.replace(/\s+/g, " ")
  return line.length > length ? `${line.slice(0, length - 1)}…` : line
}