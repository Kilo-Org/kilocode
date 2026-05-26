import { Telemetry } from "@kilocode/kilo-telemetry"
import { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { TuiEvent } from "@/cli/cmd/tui/event"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import { Instance } from "@/project/instance"
import { Provider } from "@/provider/provider"
import { ProviderID, ModelID } from "@/provider/schema"
import { Question } from "@/question"
import { Session } from "@/session/session"
import { SessionID, MessageID, PartID } from "@/session/schema"
import { MessageV2 } from "@/session/message-v2"
import { SessionStatus } from "@/session/status"
import { Todo } from "@/session/todo"
import { makeRuntime } from "@/effect/run-service"
import * as Log from "@opencode-ai/core/util/log"
import { KiloSessionPromptQueue } from "@/kilocode/session/prompt-queue"
import { lazy } from "@/util/lazy"
import path from "path"
import z from "zod"

const agents = lazy(() => makeRuntime(Agent.Service, Agent.defaultLayer))
const providers = lazy(() => makeRuntime(Provider.Service, Provider.defaultLayer))
const questions = lazy(() => makeRuntime(Question.Service, Question.defaultLayer))
const todo = lazy(() => makeRuntime(Todo.Service, Todo.defaultLayer))
const pending = new Map<SessionID, AbortController>()

export const PlanFollowupRuntime = {
  agent(name: string): Promise<Agent.Info | undefined> {
    return agents().runPromise((svc) => svc.get(name))
  },
  model(providerID: ProviderID, modelID: ModelID): Promise<Provider.Model> {
    return providers().runPromise((svc) => svc.getModel(providerID, modelID))
  },
  question: {
    ask(input: Parameters<Question.Interface["ask"]>[0]) {
      return questions().runPromise((svc) => svc.ask(input))
    },
    list() {
      return questions().runPromise((svc) => svc.list())
    },
    reject(requestID: Parameters<Question.Interface["reject"]>[0]) {
      return questions().runPromise((svc) => svc.reject(requestID))
    },
  },
  todo: {
    get(sessionID: SessionID) {
      return todo().runPromise((svc) => svc.get(sessionID))
    },
    update(input: Parameters<Todo.Interface["update"]>[0]) {
      return todo().runPromise((svc) => svc.update(input))
    },
  },
  async loop(sessionID: SessionID) {
    const item = await import("@/session/prompt")
    const prompt = makeRuntime(item.SessionPrompt.Service, item.SessionPrompt.defaultLayer)
    return prompt.runPromise((svc) => svc.loop({ sessionID }))
  },
}

function toText(item: MessageV2.WithParts): string {
  return item.parts
    .filter((part): part is MessageV2.TextPart => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim()
}

export namespace PlanFollowup {
  const log = Log.create({ service: "plan.followup" })

  export const PLAN_PREFIX = "Implement:"
  export const ANSWER_NEW_SESSION = "Start new session"
  export const ANSWER_CONTINUE = "Continue here"

  export function abort(sessionID: SessionID) {
    const ctl = pending.get(sessionID)
    if (!ctl) return false
    pending.delete(sessionID)
    ctl.abort()
    return true
  }

  function resolveVariant(value: string | undefined, model: Provider.Model | undefined) {
    if (!value) return undefined
    if (!model?.variants?.[value]) return undefined
    return value
  }

  const ModelState = z
    .object({
      model: z.record(z.string(), z.object({ providerID: ProviderID.zod, modelID: ModelID.zod })).optional(),
      variant: z.record(z.string(), z.string().optional()).optional(),
    })
    .passthrough()

  async function resolveCodeModel(input: Pick<MessageV2.User, "model">) {
    const state =
      Flag.KILO_CLIENT === "cli"
        ? await Bun.file(path.join(Global.Path.state, "model.json"))
            .text()
            .then((raw) => ModelState.safeParse(JSON.parse(raw)))
            .then((r) => (r.success ? r.data : undefined))
            .catch(() => undefined)
        : undefined
    const saved = state?.model?.code
    if (saved) {
      const full = await PlanFollowupRuntime.model(saved.providerID, saved.modelID).catch(() => undefined)
      if (full) {
        const key = `${saved.providerID}/${saved.modelID}`
        return {
          model: { ...saved, variant: resolveVariant(state?.variant?.[key], full) },
        }
      }
    }

    const entry = await PlanFollowupRuntime.agent("code")
    if (entry?.model) {
      const full = await PlanFollowupRuntime.model(entry.model.providerID, entry.model.modelID).catch(() => undefined)
      if (full) {
        return {
          model: { ...entry.model, variant: resolveVariant(entry.variant, full) },
        }
      }
    }
    return input
  }

  async function resolvePlan(input: {
    assistant?: MessageV2.WithParts
    messages: MessageV2.WithParts[]
    sessionID: SessionID
  }) {
    // Fast path: check the last assistant message's text first (avoids array scanning)
    if (input.assistant) {
      const text = toText(input.assistant)
      if (text) return text
    }

    // Fallback: scan all assistant messages after the last user message (handles
    // cases where plan text is on an earlier assistant and the last one is empty)
    const lastUserIdx = input.messages.findLastIndex((m) => m.info.role === "user")
    const assistantMessages = input.messages.slice(lastUserIdx + 1).filter((m) => m.info.role === "assistant")

    const text = assistantMessages.map(toText).filter(Boolean).join("\n\n").trim()
    if (text) return text

    // Fall back to plan file on disk
    const session = await Session.get(SessionID.make(input.sessionID))
    const file = Bun.file(Session.plan(session, Instance.current))
    const plan = await file.text().catch(() => "")
    return plan.trim()
  }

  async function inject(input: {
    sessionID: SessionID
    agent: string
    model: MessageV2.User["model"]
    text: string
    synthetic?: boolean
  }) {
    const msg: MessageV2.User = {
      id: MessageID.ascending(),
      sessionID: input.sessionID,
      role: "user",
      time: {
        created: Date.now(),
      },
      agent: input.agent,
      model: input.model,
    }
    await Session.updateMessage(msg)
    await Session.updatePart({
      id: PartID.ascending(),
      messageID: msg.id,
      sessionID: input.sessionID,
      type: "text",
      text: input.text,
      synthetic: input.synthetic ?? true,
    } satisfies MessageV2.TextPart)
    return msg
  }

  function prompt(input: { sessionID: SessionID; abort: AbortSignal }) {
    const promise = PlanFollowupRuntime.question.ask({
      sessionID: input.sessionID,
      questions: [
        {
          question: "Ready to implement?",
          questionKey: "plan.followup.question",
          header: "Implement",
          headerKey: "plan.followup.header",
          // On CLI the main prompt input is hidden while a blocking question is active,
          // so we need the custom-answer row to allow a free-text reply. On VS Code the
          // main prompt input below the dock already routes typed text as a question
          // reply, so "Type your own answer" would be redundant (originally hidden in
          // 65566af7f8, flipped back during the v1.4.4 upstream merge).
          custom: Flag.KILO_CLIENT === "cli",
          options: [
            {
              label: ANSWER_NEW_SESSION,
              labelKey: "plan.followup.answer.newSession",
              description: "Implement in a fresh session with a clean context",
              descriptionKey: "plan.followup.answer.newSession.description",
            },
            {
              label: ANSWER_CONTINUE,
              labelKey: "plan.followup.answer.continue",
              description: "Implement the plan in this session",
              descriptionKey: "plan.followup.answer.continue.description",
              mode: "code",
            },
          ],
        },
      ],
    })

    const listener = () =>
      PlanFollowupRuntime.question.list().then((qs) => {
        const match = qs.find((q) => q.sessionID === input.sessionID)
        if (match) PlanFollowupRuntime.question.reject(match.id)
      })
    input.abort.addEventListener("abort", listener, { once: true })

    return promise
      .catch((error) => {
        if (error instanceof Question.RejectedError) return undefined
        throw error
      })
      .finally(() => {
        input.abort.removeEventListener("abort", listener)
      })
  }

  async function startNew(input: {
    sessionID: SessionID
    plan: string
    model: MessageV2.User["model"]
  }) {
    const code = await resolveCodeModel({
      model: input.model,
    })
    const session = await Session.get(input.sessionID)
    const { WithInstance } = await import("@/project/with-instance")

    await WithInstance.provide({
      directory: session.directory,
      fn: async () => {
        // Create the session first so the SSE event driving the webview tab switch
        // fires before prompt seeding and implementation startup work.
        const next = await Session.create({})
        const ctl = new AbortController()
        pending.set(next.id, ctl)
        await SessionStatus.set(next.id, { type: "busy" })
        await Bus.publish(TuiEvent.SessionSelect, { sessionID: next.id })

        const idle = () =>
          SessionStatus.set(next.id, { type: "idle" }).catch((err) => {
            log.warn("failed to clear follow-up busy status", { sessionID: next.id, err })
          })

        try {
          const todos = await PlanFollowupRuntime.todo.get(input.sessionID)
          const text = `${PLAN_PREFIX}\n\n${input.plan}\n\nThis plan was created in session ${input.sessionID}. Use \`kilo_local_recall\` to retrieve additional context from that session only if needed.`

          await inject({
            sessionID: next.id,
            agent: "code",
            model: code.model,
            text,
            synthetic: false,
          })

          if (todos.length) {
            await PlanFollowupRuntime.todo.update({ sessionID: next.id, todos })
          }
          if (ctl.signal.aborted) {
            await idle()
            return
          }

          const queue = WithInstance.provide({
            directory: next.directory,
            fn: async () => {
              if (ctl.signal.aborted) {
                await idle()
                return
              }
              await PlanFollowupRuntime.loop(next.id)
            },
          })

          void queue
            .catch((error) => {
              log.error("failed to start follow-up session", { sessionID: next.id, error })
              void idle()
            })
            .finally(() => {
              if (pending.get(next.id) === ctl) pending.delete(next.id)
            })
        } catch (error) {
          if (pending.get(next.id) === ctl) pending.delete(next.id)
          await idle()
          throw error
        }
      },
    })
  }

  export async function ask(input: {
    sessionID: SessionID
    messages: MessageV2.WithParts[]
    abort: AbortSignal
  }): Promise<"continue" | "break"> {
    if (input.abort.aborted) return "break"

    const latest = input.messages.slice().reverse()
    const assistant = latest.find((msg) => msg.info.role === "assistant")
    if (!assistant) return "break"

    const plan = await resolvePlan({ assistant, messages: input.messages, sessionID: input.sessionID })
    if (!plan) return "break"

    const user = latest.find((msg) => msg.info.role === "user")?.info
    if (!user || user.role !== "user" || !user.model) return "break"

    const answers = await prompt({ sessionID: input.sessionID, abort: input.abort })
    if (!answers) {
      Telemetry.trackPlanFollowup(input.sessionID, "dismissed")
      return "break"
    }

    const answer = answers[0]?.[0]?.trim()
    if (!answer) {
      Telemetry.trackPlanFollowup(input.sessionID, "dismissed")
      return "break"
    }

    if (answer === ANSWER_NEW_SESSION) {
      Telemetry.trackPlanFollowup(input.sessionID, "new_session")
      await startNew({
        sessionID: input.sessionID,
        plan,
        model: user.model,
      })
      return "break"
    }

    if (answer === ANSWER_CONTINUE) {
      Telemetry.trackPlanFollowup(input.sessionID, "continue")
      const code = await resolveCodeModel({
        model: user.model,
      })
      const msg = await inject({
        sessionID: input.sessionID,
        agent: "code",
        model: code.model,
        text: "Implement the plan above.",
      })
      KiloSessionPromptQueue.retarget(input.sessionID, msg.id)
      return "continue"
    }

    Telemetry.trackPlanFollowup(input.sessionID, "custom")
    const msg = await inject({
      sessionID: input.sessionID,
      agent: "plan",
      model: user.model,
      text: answer,
    })
    KiloSessionPromptQueue.retarget(input.sessionID, msg.id)
    return "continue"
  }
}
