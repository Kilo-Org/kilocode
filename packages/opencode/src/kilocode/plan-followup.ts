import { Telemetry } from "@kilocode/kilo-telemetry"
import { Agent } from "@/agent/agent"
import { TuiEvent } from "@/server/tui-event"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import { Identifier } from "@/id/id"
import { Instance } from "@/kilocode/instance"
import { Provider } from "@/provider/provider"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Config } from "@/config/config"
import { InstanceRef } from "@/effect/instance-ref"
import { Question } from "@/question"
import { Session } from "@/session/session"
import { SessionID, MessageID, PartID } from "@/session/schema"
import { LLM } from "@/session/llm"
import { KiloLLM } from "@/kilocode/session/llm"
import { KiloSessionOverflow } from "@/kilocode/session/overflow"
import { MessageV2 } from "@/session/message-v2"
import { usable } from "@/session/overflow"
import { SessionStatus } from "@/session/status"
import { Todo } from "@/session/todo"
import { makeRuntime } from "@/effect/run-service"
import { Effect, Schema } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import { KiloSessionPromptQueue } from "@/kilocode/session/prompt-queue"
import { lazy } from "@/util/lazy"
import path from "path"
import z from "zod"
import { PlanFile } from "@/kilocode/plan-file"

const agents = lazy(() => makeRuntime(Agent.Service, Agent.defaultLayer))
const providers = lazy(() => makeRuntime(Provider.Service, Provider.defaultLayer))
const configs = lazy(() => makeRuntime(Config.Service, Config.defaultLayer))
const todo = lazy(() => makeRuntime(Todo.Service, Todo.defaultLayer))
const llm = lazy(() => makeRuntime(LLM.Service, LLM.defaultLayer))
const pending = new Map<SessionID, AbortController>()

export const PlanFollowupRuntime = {
  agent(name: string): Promise<Agent.Info | undefined> {
    return agents().runPromise((svc) => svc.get(name))
  },
  model(providerID: ProviderV2.ID, modelID: ModelV2.ID): Promise<Provider.Model> {
    return providers().runPromise((svc) => svc.getModel(providerID, modelID))
  },
  config(): Promise<Config.Info> {
    return configs().runPromise((svc) => svc.get())
  },
  todo: {
    get(sessionID: SessionID) {
      return todo().runPromise((svc) => svc.get(sessionID))
    },
    update(input: Parameters<Todo.Interface["update"]>[0]) {
      return todo().runPromise((svc) => svc.update(input))
    },
  },
  handover(input: LLM.StreamInput, signal: AbortSignal) {
    return llm().runPromise((svc) => KiloLLM.text(svc.stream(input)).pipe(Effect.orDie), { signal })
  },
  async session<A, E>(run: (svc: Session.Interface) => Effect.Effect<A, E>) {
    const { AppRuntime } = await import("@/effect/app-runtime")
    return AppRuntime.runPromise(Session.Service.use(run))
  },
  async loop(sessionID: SessionID) {
    const [item, app] = await Promise.all([import("@/session/prompt"), import("@/effect/app-runtime")])
    return app.AppRuntime.runPromise(item.SessionPrompt.Service.use((svc) => svc.loop({ sessionID })))
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

    const result = await PlanFollowupRuntime.handover(
      {
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
        sessionID,
        system: [],
        retries: 1,
      },
      input.abort ? AbortSignal.any([input.abort, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
    )
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
  export const ANSWER_KEEP_REFINING = "Keep refining"

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
      model: z
        .record(
          z.string(),
          z.object({
            providerID: z.custom<ProviderV2.ID>(Schema.is(ProviderV2.ID)),
            modelID: z.custom<ModelV2.ID>(Schema.is(ModelV2.ID)),
          }),
        )
        .optional(),
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
          full,
        }
      }
    }

    const entry = await PlanFollowupRuntime.agent("code").catch(() => undefined)
    if (entry?.model) {
      const full = await PlanFollowupRuntime.model(entry.model.providerID, entry.model.modelID).catch(() => undefined)
      if (full) {
        return {
          model: { ...entry.model, variant: resolveVariant(entry.variant, full) },
          full,
        }
      }
    }
    return {
      model: input.model,
      full: await PlanFollowupRuntime.model(input.model.providerID, input.model.modelID).catch(() => undefined),
    }
  }

  async function estimate(input: { assistant: MessageV2.WithParts; model?: Provider.Model }) {
    if (!input.model || input.model.limit.context === 0 || input.assistant.info.role !== "assistant") return
    const tokens = KiloSessionOverflow.count(input.assistant.info.tokens)
    if (!tokens) return

    const context = input.model.limit.input || input.model.limit.context
    if (context === 0) return
    const percent = Math.round((tokens / context) * 100)
    const cfg = await PlanFollowupRuntime.config().catch(() => undefined)
    if (!cfg) return { percent, recommended: false }
    return {
      percent,
      recommended:
        cfg.compaction?.auto !== false &&
        tokens >=
          KiloSessionOverflow.limit({
            cfg,
            model: input.model,
            usable: usable({ cfg, model: input.model }),
          }),
    }
  }

  async function locatePlan(sessionID: SessionID, messages: MessageV2.WithParts[]) {
    const ctx = Instance.current
    const session = await PlanFollowupRuntime.session((svc) => svc.get(sessionID))
    const target = PlanFile.resolve(PlanFile.latest(messages), ctx) ?? Session.plan(session, ctx)
    const agent = messages.findLast((m) => m.info.role === "user")?.info.agent
    const file = await PlanFile.locate(target, messages, session, ctx, agent)
    return { target, file }
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
    const { target, file } = await locatePlan(input.sessionID, input.messages)
    if (!file) {
      log.warn("resolvePlan: no saved plan file found", { sessionID: input.sessionID, target })
      return ""
    }
    const plan = await Bun.file(file)
      .text()
      .catch(() => "")
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
    await PlanFollowupRuntime.session((svc) =>
      Effect.gen(function* () {
        yield* svc.updateMessage(msg)
        yield* svc.updatePart({
          id: PartID.ascending(),
          messageID: msg.id,
          sessionID: input.sessionID,
          type: "text",
          text: input.text,
          synthetic: input.synthetic ?? true,
        } satisfies MessageV2.TextPart)
      }),
    )
    return msg
  }

  type QuestionRuntime = {
    ask: (input: Parameters<Question.Interface["ask"]>[0]) => Promise<ReadonlyArray<Question.Answer>>
    list: () => Promise<ReadonlyArray<Question.Request>>
    reject: (requestID: Parameters<Question.Interface["reject"]>[0]) => Promise<void>
  }

  function prompt(input: {
    sessionID: SessionID
    abort: AbortSignal
    question: QuestionRuntime
    estimate?: { percent: number; recommended: boolean }
  }) {
    if (input.abort.aborted) return Promise.resolve(undefined)
    const promise = input.question.ask({
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
          custom: Flag.KILO_CLIENT === "cli" || Flag.KILO_CLIENT === "jetbrains",
          options: [
            {
              label: ANSWER_NEW_SESSION,
              labelKey: "plan.followup.answer.newSession",
              description: input.estimate?.recommended
                ? "Implement in a fresh session with a clean context (Recommended)"
                : "Implement in a fresh session with a clean context",
              descriptionKey: input.estimate?.recommended
                ? "plan.followup.answer.newSession.recommended.description"
                : "plan.followup.answer.newSession.description",
            },
            {
              label: ANSWER_CONTINUE,
              labelKey: "plan.followup.answer.continue",
              description: input.estimate
                ? `Implement the plan in this session (using ${input.estimate.percent}% of Code mode context)`
                : "Implement the plan in this session",
              descriptionKey: input.estimate
                ? "plan.followup.answer.continue.estimated.description"
                : "plan.followup.answer.continue.description",
              descriptionArgs: input.estimate ? [String(input.estimate.percent)] : undefined,
              mode: "code",
            },
            {
              label: ANSWER_KEEP_REFINING,
              labelKey: "plan.followup.answer.keepRefining",
              description: "Keep planning without implementing yet",
              descriptionKey: "plan.followup.answer.keepRefining.description",
              mode: "plan",
            },
          ],
        },
      ],
    })

    const listener = () =>
      input.question
        .list()
        .then((qs) => {
          const match = qs.find((q) => q.sessionID === input.sessionID)
          return match ? input.question.reject(match.id) : undefined
        })
        .catch((error) => {
          log.warn("failed to reject aborted plan follow-up question", { sessionID: input.sessionID, error })
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
    file?: string
    messages: MessageV2.WithParts[]
    model: MessageV2.User["model"]
    abort?: AbortSignal
  }) {
    const code = await resolveCodeModel({
      model: input.model,
    })
    const session = await PlanFollowupRuntime.session((svc) => svc.get(input.sessionID))
    const { provide } = await import("@/kilocode/instance")

    await provide({
      directory: session.directory,
      fn: async () => {
        // Create the session FIRST so session.created fires immediately while the
        // VS Code extension's pendingFollowup gate (30s TTL) is still fresh. The
        // handover generation below can take tens of seconds and must not block
        // the SSE event that drives the webview tab switch.
        const next = await PlanFollowupRuntime.session((svc) => svc.create({}))
        const ctl = new AbortController()
        pending.set(next.id, ctl)
        const [{ AppRuntime }, { EventV2Bridge }] = await Promise.all([
          import("@/effect/app-runtime"),
          import("@/event-v2-bridge"),
        ])
        await AppRuntime.runPromise(SessionStatus.Service.use((svc) => svc.set(next.id, { type: "busy" })))
        await AppRuntime.runPromise(
          EventV2Bridge.Service.use((events) => events.publish(TuiEvent.SessionSelect, { sessionID: next.id })).pipe(
            Effect.provideService(InstanceRef, Instance.current),
          ),
        )

        const idle = () =>
          AppRuntime.runPromise(SessionStatus.Service.use((svc) => svc.set(next.id, { type: "idle" }))).catch((err) => {
            log.warn("failed to clear follow-up busy status", { sessionID: next.id, err })
          })

        try {
          const file = input.file ?? Session.plan(session, Instance.current)
          const todos = await PlanFollowupRuntime.todo.get(input.sessionID)
          const todoList = formatTodos(todos)

          // Assemble the user message text with or without a handover section.
          // The section order is fixed so the initial and final renders stay
          // aligned; only the handover block grows in between.
          const compose = (handover: string) => {
            const sections = [
              `Plan file: ${file}\nRead this file first and treat it as the source of truth for implementation.`,
            ]
            if (handover) sections.push(`## Handover from Planning Session\n\n${handover}`)
            if (todoList) sections.push(`## Todo List\n\n${todoList}`)
            return sections.join("\n\n")
          }

          // Inject the plan-file handoff and todos immediately so the new session tab
          // shows useful content right away. The handover section is appended to this
          // same part in-place once the slow LLM call resolves below.
          const msg: MessageV2.User = {
            id: MessageID.ascending(),
            sessionID: next.id,
            role: "user",
            time: { created: Date.now() },
            agent: "code",
            model: code.model,
          }
          const pid = PartID.ascending()
          await PlanFollowupRuntime.session((svc) =>
            Effect.gen(function* () {
              yield* svc.updateMessage(msg)
              yield* svc.updatePart({
                id: pid,
                messageID: msg.id,
                sessionID: next.id,
                type: "text",
                text: compose(""),
                synthetic: false,
              } satisfies MessageV2.TextPart)
            }),
          )

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
            await PlanFollowupRuntime.session((svc) =>
              svc.updatePart({
                id: pid,
                messageID: msg.id,
                sessionID: next.id,
                type: "text",
                text: compose(handover),
                synthetic: false,
              } satisfies MessageV2.TextPart),
            )
          }
          if (ctl.signal.aborted) {
            await idle()
            return
          }

          const queue = provide({
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
    question: QuestionRuntime
  }): Promise<"continue" | "break"> {
    if (input.abort.aborted) return "break"

    const latest = input.messages.slice().reverse()
    const assistant = latest.find((msg) => msg.info.role === "assistant")
    if (!assistant) return "break"

    const plan = await resolvePlan({ assistant, messages: input.messages, sessionID: input.sessionID })
    if (!plan) return "break"

    const user = latest.find((msg) => msg.info.role === "user")?.info
    if (!user || user.role !== "user" || !user.model) return "break"

    const code = assistant.info.role === "assistant" && KiloSessionOverflow.count(assistant.info.tokens)
      ? await resolveCodeModel({ model: user.model })
      : undefined
    const context = await estimate({ assistant, model: code?.full })
    const answers = await prompt({
      sessionID: input.sessionID,
      abort: input.abort,
      question: input.question,
      estimate: context,
    })
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
      const ctx = Instance.current
      const { file } = await locatePlan(input.sessionID, input.messages)
      await startNew({
        sessionID: input.sessionID,
        file: file ? PlanFile.display(file, ctx) : undefined,
        messages: input.messages,
        model: user.model,
        abort: input.abort,
      })
      return "break"
    }

    if (answer === ANSWER_CONTINUE) {
      Telemetry.trackPlanFollowup(input.sessionID, "continue")
      const model = code ?? (await resolveCodeModel({ model: user.model }))
      const msg = await inject({
        sessionID: input.sessionID,
        agent: "code",
        model: model.model,
        text: "Implement the plan above.",
      })
      KiloSessionPromptQueue.retarget(input.sessionID, msg.id)
      return "continue"
    }

    if (answer === ANSWER_KEEP_REFINING) {
      Telemetry.trackPlanFollowup(input.sessionID, "keep_refining")
      const msg = await inject({
        sessionID: input.sessionID,
        agent: "plan",
        model: user.model,
        text: "Continue refining the plan. Do not implement yet.",
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
