export * as PlanFollowup from "./plan-followup"

// Core internals with no public surface: the ask/answer service behind the native question tool, the durable
// session store the turn is read from, the global event bus for the client session switch, and stateless
// generation for the handover summary.
import { Bus } from "@opencode/core/bus"
import { Form } from "@opencode/core/form"
import { Generate } from "@opencode/core/generate"
import { SessionStore } from "@opencode/core/session/store"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Agent } from "@opencode/schema/agent"
import type { Session } from "@opencode/schema/session"
import type { SessionMessage } from "@opencode/schema/session-message"
import { TuiEvent } from "@opencode/schema/tui-event"
import { dict } from "@kilocode/kilo-i18n/en"
import { Effect, Option } from "effect"
import { hints } from "../question"
import { PlanFile } from "./plan-file"
import { PlanHandover } from "./handover"

export const NEW_SESSION = dict["plan.followup.answer.newSession"]
export const CONTINUE = dict["plan.followup.answer.continue"]
export const KEEP_REFINING = dict["plan.followup.answer.keepRefining"]

const code = Agent.ID.make("code")

const OPTIONS = [
  {
    label: NEW_SESSION,
    description: dict["plan.followup.answer.newSession.description"],
    labelKey: "plan.followup.answer.newSession",
    descriptionKey: "plan.followup.answer.newSession.description",
  },
  {
    label: CONTINUE,
    description: dict["plan.followup.answer.continue.description"],
    labelKey: "plan.followup.answer.continue",
    descriptionKey: "plan.followup.answer.continue.description",
    mode: "code",
  },
  {
    label: KEEP_REFINING,
    description: dict["plan.followup.answer.keepRefining.description"],
    labelKey: "plan.followup.answer.keepRefining",
    descriptionKey: "plan.followup.answer.keepRefining.description",
    mode: "plan",
  },
]

/** VS Code routes text typed in its main prompt input as the answer, so the custom row is hidden there. */
const fields = (custom: boolean): Form.Fields => [
  {
    key: "q0",
    title: dict["plan.followup.header"],
    description: dict["plan.followup.question"],
    type: "string",
    options: OPTIONS.map((option) => ({
      value: option.label,
      label: option.label,
      description: option.description,
    })),
    custom,
  },
]

const METADATA = {
  kind: "question",
  kilocode: {
    options: hints([
      {
        question: dict["plan.followup.question"],
        header: dict["plan.followup.header"],
        options: OPTIONS,
      },
    ]),
  },
}

/**
 * Asks the post-plan question when the turn that just ended called `plan_exit`, and acts on the answer:
 * implement in a fresh session, switch this session to Code and implement, or keep refining in Plan.
 */
export const ask = Effect.fn(function* (input: {
  ctx: Context
  store: SessionStore.Interface
  bus: Bus.Interface
  handled: Map<Session.ID, SessionMessage.ID>
  data: string
  document: boolean
  sessionID: Session.ID
}) {
  const forms = yield* Effect.serviceOption(Form.Service)
  if (Option.isNone(forms)) return

  const session = yield* input.store.get(input.sessionID)
  if (!session) return

  // Read one row for the current turn, then only that turn. A long Code history is not loaded.
  const [lastUser] = yield* input.store.messages({ sessionID: input.sessionID, order: "desc", limit: 1, type: "user" })
  if (!lastUser) return
  if (input.handled.get(input.sessionID) === lastUser.id) return
  const messages = yield* input.store.messages({
    sessionID: input.sessionID,
    order: "asc",
    cursor: { id: lastUser.id, direction: "next" },
  })
  const exit = planExit(messages)
  if (!exit) return
  // The part's agent, not the session's current agent: the user can switch agents after plan_exit.
  if (!PlanFile.isPlanner(exit.agent)) return
  // Recorded only for a plan_exit turn, so a later idle of the same turn cannot hide a plan_exit that arrives late.
  input.handled.set(input.sessionID, lastUser.id)

  const state = yield* forms.value.ask({
    sessionID: input.sessionID,
    title: dict["plan.followup.header"],
    metadata: METADATA,
    fields: fields(!input.document),
  })
  if (state.status !== "answered") return

  const value = state.answer["q0"]
  const answer = typeof value === "string" ? value.trim() : ""
  if (!answer) return

  if (answer === NEW_SESSION) return yield* newSession(input, session, exit.part)
  if (answer === CONTINUE) {
    yield* input.ctx.session.switchAgent({ sessionID: input.sessionID, agent: code })
    yield* input.ctx.session.prompt({ sessionID: input.sessionID, text: "Implement the plan above." })
    return
  }
  const text = answer === KEEP_REFINING ? "Continue refining the plan. Do not implement yet." : answer
  yield* input.ctx.session.prompt({ sessionID: input.sessionID, text })
})

/** The completed plan_exit call of the turn that just ended. */
function planExit(messages: ReadonlyArray<SessionMessage.Info>) {
  for (const message of messages.toReversed()) {
    if (message.type !== "assistant") continue
    for (const part of message.content.toReversed()) {
      if (part.type !== "tool" || part.name !== "plan_exit" || part.state.status !== "completed") continue
      return { part, agent: message.agent }
    }
  }
}

/** The planning messages the handover summary reads. Bounded: the summary needs the recent planning context. */
const HISTORY = 200

const newSession = Effect.fn(function* (
  input: { ctx: Context; store: SessionStore.Interface; bus: Bus.Interface; data: string; sessionID: Session.ID },
  session: Session.Info,
  exit: SessionMessage.AssistantTool,
) {
  const metadata = exit.state.status === "completed" ? exit.state.metadata : undefined
  const named = metadata?.["plan"]
  const file =
    (typeof named === "string" ? PlanFile.resolve(named, input.ctx.location, input.data) : undefined) ??
    PlanFile.defaultPath(session, input.ctx.location, input.data)
  const history = (yield* input.store.messages({ sessionID: input.sessionID, order: "desc", limit: HISTORY })).toReversed()

  // Create and show the session first: the summary can take seconds and the client switches on the select event.
  const next = yield* input.ctx.session.create({ agent: code })
  yield* input.bus.publish(TuiEvent.SessionSelect, { sessionID: next.id })

  const handover = yield* summary(input.ctx, history)
  const todos = PlanHandover.todos(history)
  const text = [
    `Plan file: ${PlanFile.display(file, input.ctx.location)}\nRead this file first and treat it as the source of truth for implementation.`,
    ...(handover ? [`## Handover from Planning Session\n\n${handover}`] : []),
    ...(todos ? [`## Todo List\n\n${todos}`] : []),
  ].join("\n\n")
  yield* input.ctx.session.prompt({ sessionID: next.id, text })
})

/** The handover summary from the compaction agent model when one is set, else the default model. */
const summary = Effect.fn(function* (ctx: Context, history: ReadonlyArray<SessionMessage.Info>) {
  const generate = yield* Effect.serviceOption(Generate.Service)
  if (Option.isNone(generate)) return ""
  const model = yield* ctx.agent.get({ agentID: Agent.ID.make("compaction") }).pipe(
    Effect.map((result) => result.data.model),
    Effect.orElseSucceed(() => undefined),
  )
  return yield* PlanHandover.generate({
    messages: history,
    model,
    generate: (request) => generate.value.text(request),
  })
})
