import { Telemetry } from "@kilocode/kilo-telemetry"
import { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { TuiEvent } from "@/cli/cmd/tui/event"
import { Flag } from "@/flag/flag"
import { Global } from "@/global"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { Provider } from "@/provider"
import { ProviderID, ModelID } from "@/provider/schema"
import { Question } from "@/question"
import { Session } from "@/session"
import { SessionID, MessageID, PartID } from "@/session/schema"
import { LLM } from "@/session/llm"
import { MessageV2 } from "@/session/message-v2"
import { SessionStatus } from "@/session/status"
import { Todo } from "@/session/todo"
import { makeRuntime } from "@/effect/run-service"
import { Log } from "@/util"
import { KiloSessionPromptQueue } from "@/kilocode/session/prompt-queue"
import path from "path"
import z from "zod"

const agents = makeRuntime(Agent.Service, Agent.defaultLayer)
const providers = makeRuntime(Provider.Service, Provider.defaultLayer)
const questions = makeRuntime(Question.Service, Question.defaultLayer)
const todo = makeRuntime(Todo.Service, Todo.defaultLayer)
const pending = new Map<SessionID, AbortController>()

export const PlanFollowupRuntime = {
  agent(name: string): Promise<Agent.Info | undefined> {
    return agents.runPromise((svc) => svc.get(name))
  },
  model(providerID: ProviderID, modelID: ModelID): Promise<Provider.Model> {
    return providers.runPromise((svc) => svc.getModel(providerID, modelID))
  },
  question: {
    ask(input: Parameters<Question.Interface["ask"]>[0]) {
      return questions.runPromise((svc) => svc.ask(input))
    },
    list() {
      return questions.runPromise((svc) => svc.list())
    },
    reject(requestID: Parameters<Question.Interface["reject"]>[0]) {
      return questions.runPromise((svc) => svc.reject(requestID))
    },
  },
  todo: {
    get(sessionID: SessionID) {
      return todo.runPromise((svc) => svc.get(sessionID))
    },
    update(input: Parameters<Todo.Interface["update"]>[0]) {
      return todo.runPromise((svc) => svc.update(input))
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

const HANDOVER_PROMPT = `You are summarizing a planning session to hand off to an implementation session.

The plan itself will be provided separately — do NOT repeat it. Instead, focus on information discovered during planning that would help the implementing agent but is NOT already in the plan text.

Produce a concise summary using this template:
---
## Discoveries

[Key findings from code exploration — architecture patterns, gotchas, edge cases, relevant existing code that the plan references but doesn't fully explain]

## Relevant Files

[Structured list of files/directories that were read or discussed, with brief notes on what's relevant in each]

## Implementation Notes

[Any important context: conventions to follow, potential pitfalls, dependencies between steps, things the implementing agent should watch out for]
---

If there is nothing useful to add beyond what the plan already says, respond with an empty string.
Keep the summary concise — focus on high-entropy information that would save the implementing agent time.`

export function formatTodos(todos: Todo.Info[]): string {
  if (!todos.length) return ""
  const icons: Record<string, string> = {
    completed: "[x]",
    in_progress: "[~]",
    cancelled: "[-]",
  }
  return todos.map((t) => `- ${icons[t.status] ?? "[ ]"} ${t.content}`).join("\n")
}

export async function generateHandover(input: {
  messages: MessageV2.WithParts[]
  model: MessageV2.User["model"]
  abort?: AbortSignal
}): Promise<string> {
  const log = Log.create({ service: "plan.followup" })
  try {
    const entry = await PlanFollowupRuntime.agent("compaction")
    const model = entry?.model
      ? await PlanFollowupRuntime.model(entry.model.providerID, entry.model.modelID)
      : await PlanFollowupRuntime.model(input.model.providerID, input.model.modelID)

    const sessionID = SessionID.make(Identifier.ascending("session"))
    const userMsg: MessageV2.User = {
      id: MessageID.ascending(),
      sessionID,
      role: "user",
      time: { created: Date.now() },
      agent: "plan",
      model: input.model,
    }

    const stream = await LLM.stream({
      agent: entry ?? {
        name: "compaction",
        mode: "subagent",
        permission: [],
        options: {},
      },
      user: userMsg,
      tools: {},
      model,
      small: true,
      messages: [
        ...(await MessageV2.toModelMessages(input.messages, model)),
        {
          role: "user" as const,
          content: HANDOVER_PROMPT,
        },
      ],
      abort: input.abort ? AbortSignal.any([input.abort, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
      sessionID,
      system: [],
      retries: 1,
    })

    const result = await stream.text
    return result.trim()
  } catch (error) {
    if (input.abort?.aborted) return ""
    log.error("handover generation failed", { error })
    return ""
  }
}

export namespace PlanFollowup {
  const log = Log.create({ service: "plan.followup" })

  export const PLAN_PREFIX = "Implement the following plan:"
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
    const file = Bun.file(Session.plan(session))
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
    messages: MessageV2.WithParts[]
    model: MessageV2.User["model"]
    abort?: AbortSignal
  }) {
    const code = await resolveCodeModel({
      model: input.model,
    })
    const session = await Session.get(input.sessionID)

    await Instance.provide({
      directory: session.directory,
      fn: async () => {
        // Create the session FIRST so session.created fires immediately while the
        // VS Code extension's pendingFollowup gate (30s TTL) is still fresh. The
        // handover generation below can take tens of seconds and must not block
        // the SSE event that drives the webview tab switch.
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
          const file = Session.plan(session)
          const todos = await PlanFollowupRuntime.todo.get(input.sessionID)
          const todoList = formatTodos(todos)

          // Assemble the user message text with or without a handover section.
          // The section order is fixed so the initial and final renders stay
          // aligned — only the handover block grows in between.
          const compose = (handover: string) => {
            const sections = [
              `Plan file: ${file}\nRead this file first and treat it as the source of truth for implementation.`,
              `Implement the following plan:\n\n${input.plan}`,
            ]
            if (handover) sections.push(`## Handover from Planning Session\n\n${handover}`)
            if (todoList) sections.push(`## Todo List\n\n${todoList}`)
            return sections.join("\n\n")
          }

          // Inject the plan and todos immediately so the new session tab shows
          // real content right away. The handover section is appended to this
          // same part in-place once the slow LLM call resolves below.
          const msg: MessageV2.User = {
            id: MessageID.ascending(),
            sessionID: next.id,
            role: "user",
            time: { created: Date.now() },
            agent: "code",
            model: code.model,
          }
          await Session.updateMessage(msg)
          const pid = PartID.ascending()
          await Session.updatePart({
            id: pid,
            messageID: msg.id,
            sessionID: next.id,
            type: "text",
            text: compose(""),
            synthetic: false,
          } satisfies MessageV2.TextPart)

          if (todos.length) {
            await PlanFollowupRuntime.todo.update({ sessionID: next.id, todos })
          }

          const handover = await generateHandover({
            messages: input.messages,
            model: input.model,
            abort: input.abort ? AbortSignal.any([input.abort, ctl.signal]) : ctl.signal,
          })
          if (ctl.signal.aborted) {
            await idle()
            return
          }

          if (handover) {
            await Session.updatePart({
              id: pid,
              messageID: msg.id,
              sessionID: next.id,
              type: "text",
              text: compose(handover),
              synthetic: false,
            } satisfies MessageV2.TextPart)
          }
          if (ctl.signal.aborted) {
            await idle()
            return
          }

          const queue = Instance.provide({
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
        messages: input.messages,
        model: user.model,
        abort: input.abort,
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
