import { Cause, Effect, Scope } from "effect"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { NamedError } from "@opencode-ai/core/util/error"
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
import { KiloSessionControl } from "./control"
import { GoalState } from "./goal-state"
import { SessionDrain } from "./drain"

export namespace Goal {
  const help =
    "Use /goal <objective> to keep working toward a goal in this session. Runs repeat until paused and use model credits. /goal pause stops, /goal resume continues, and /goal clear removes the goal. Stop or a new message also pauses it. Goals stay paused after a restart."

  export function completed(result: SessionV1.WithParts) {
    return (
      result.info.role === "assistant" &&
      result.info.finish === "stop" &&
      !result.info.error &&
      !result.parts.some(
        (part) =>
          part.type === "tool" &&
          (part.state.status === "error" ||
            part.tool === "plan_exit" ||
            (part.state.status === "completed" && part.state.metadata?.dismissed === true)),
      )
    )
  }

  export function make(ops: {
    create: (input: PromptInput) => Effect.Effect<SessionV1.WithParts>
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
      const state = yield* SessionRunState.Service
      const permission = yield* Permission.Service
      const question = yield* Question.Service
      const events = yield* EventV2Bridge.Service
      const drain = yield* SessionDrain.Service
      const scopes = yield* InstanceState.make(() => Scope.Scope)

      const pause = Effect.fn("Goal.pause")(function* (id: SessionID, preserve = false) {
        if (!GoalState.pause(id, preserve)) return
        yield* sessions.touch(id)
      })

      const command = Effect.fn("Goal.command")(function* (input: CommandInput) {
        const id = input.sessionID
        const args = input.arguments.trim()
        const starting = args !== "" && args !== "pause" && args !== "clear"
        const intent = starting ? GoalState.prepare(id) : undefined
        return yield* Effect.gen(function* () {
          const session = yield* sessions.get(id).pipe(Effect.orDie)
          const saved = GoalState.read(session.metadata)
          const text = args === "resume" ? saved?.text : starting ? args : saved?.text
          if (starting && !text) return yield* Effect.fail(new Error("Set a goal with /goal <objective> first."))
          if (text && text.length > 10_000)
            return yield* Effect.fail(new Error("Keep the goal under 10,000 characters."))
          if (intent && !intent.current()) return yield* Effect.interrupt
          if (args && GoalState.active(id)) yield* ops.cancel(id, starting)
          if (args === "pause" || args === "clear") yield* pause(id)
          const prior = yield* ops.control.begin(id, false)
          if (starting) {
            if (session.time.archived || session.revert) {
              return yield* Effect.fail(new Error("Restore this session before starting a goal."))
            }
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
              return yield* Effect.fail(new Error("Resolve pending questions and permissions before starting a goal."))
            }
          }
          if (intent && !intent.current()) return yield* Effect.interrupt
          const ticket = starting ? yield* ops.control.begin(id, true, prior) : prior
          if (!ticket.current() || (intent && !intent.current())) return yield* Effect.interrupt
          const current = starting ? GoalState.start(id) : undefined
          let started = false
          return yield* Effect.gen(function* () {
            const metadata = { ...session.metadata }
            if (args === "clear") delete metadata["kilo.goal"]
            else if (text) metadata["kilo.goal"] = { text }
            if (args) yield* sessions.setMetadata({ sessionID: id, metadata })
            const notice = !args
              ? `${text ? `Goal ${GoalState.active(id) ? "active" : "paused"}: ${text}\n\n` : ""}${help}`
              : args === "clear"
                ? "Goal cleared."
                : starting
                  ? "Goal active. Runs repeat until paused and use model credits. Use Stop or /goal pause to pause."
                  : "Goal paused. Use /goal resume to continue."
            const user = starting
              ? (yield* ops.create({
                  sessionID: id,
                  messageID: input.messageID,
                  agent: input.agent,
                  model: input.model ? Provider.parseModel(input.model) : undefined,
                  variant: input.variant,
                  parts: [{ type: "text", text: `/goal ${args}`, ignored: true }],
                })).info
              : undefined
            if (user && user.role !== "user") return yield* Effect.die(new Error("Expected a user message"))
            if (current && !current()) return yield* Effect.interrupt
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
              yield* Effect.gen(function* () {
                let first = true
                while (current() && ticket.running()) {
                  yield* drain.wait(id)
                  const session = yield* sessions.get(id).pipe(Effect.orDie)
                  if (!current() || !ticket.running() || session.time.archived || session.revert) break
                  const messageID = MessageID.ascending()
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
                            text: `Continue working toward this session goal:\n\n${text}\n\nUse the existing conversation and take the next useful step. Do not repeat completed work or status-only reports. If the goal is met or you cannot make progress safely, ask the user with the question tool and wait. Keep all existing permission and scope limits.`,
                          },
                          ...(first ? (input.parts ?? []) : []),
                        ],
                      },
                      guard,
                    ),
                  )
                  first = false
                  if (!completed(result) || result.info.role !== "assistant" || result.info.parentID !== messageID)
                    break
                  yield* Effect.sleep("5 seconds")
                }
              }).pipe(
                Effect.catchCause((cause) =>
                  Effect.gen(function* () {
                    if (Cause.hasInterruptsOnly(cause)) return
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
          }).pipe(Effect.ensuring(Effect.suspend(() => (!started && current?.() ? pause(id, true) : Effect.void))))
        }).pipe(Effect.ensuring(Effect.sync(() => intent?.release())))
      })
      return { command, pause }
    })
  }
}
