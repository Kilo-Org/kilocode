import { Telemetry } from "@kilocode/kilo-telemetry"
import { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { TuiEvent } from "@/cli/cmd/tui/event"
import { Identifier } from "@/id/id"
import { Provider } from "@/provider/provider"
import { Question } from "@/question"
import { Session } from "@/session"
import { LLM } from "@/session/llm"
import { MessageV2 } from "@/session/message-v2"
import { Todo } from "@/session/todo"
import { Log } from "@/util/log"

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
    const agent = await Agent.get("compaction")
    const model = agent?.model
      ? await Provider.getModel(agent.model.providerID, agent.model.modelID)
      : await Provider.getModel(input.model.providerID, input.model.modelID)

    const sessionID = Identifier.ascending("session")
    const userMsg: MessageV2.User = {
      id: Identifier.ascending("message"),
      sessionID,
      role: "user",
      time: { created: Date.now() },
      agent: "plan",
      model: input.model,
    }

    const stream = await LLM.stream({
      agent: agent ?? {
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
        ...MessageV2.toModelMessages(input.messages, model),
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
    log.error("handover generation failed", { error })
    return ""
  }
}

export namespace PlanFollowup {
  const log = Log.create({ service: "plan.followup" })

  export const ANSWER_NEW_SESSION = "Start new session"
  export const ANSWER_CONTINUE = "Continue here"

  async function resolvePlan(input: { assistant?: MessageV2.WithParts; messages: MessageV2.WithParts[]; sessionID: string }) {
    // Fast path: check the last assistant message's text first (avoids array scanning)
    if (input.assistant) {
      const text = toText(input.assistant)
      if (text) return text
    }

    // Fallback: scan all assistant messages after the last user message (handles
    // cases where plan text is on an earlier assistant and the last one is empty)
    const lastUserIdx = input.messages.findLastIndex((m) => m.info.role === "user")
    const assistantMessages = input.messages
      .slice(lastUserIdx + 1)
      .filter((m) => m.info.role === "assistant")

    const text = assistantMessages.map(toText).filter(Boolean).join("\n\n").trim()
    if (text) return text

    // Fall back to plan file on disk
    const session = await Session.get(input.sessionID)
    const file = Bun.file(Session.plan(session))
    const plan = await file.text().catch(() => "")
    return plan.trim()
  }

  async function inject(input: {
    sessionID: string
    agent: string
    model: MessageV2.User["model"]
    text: string
    synthetic?: boolean
  }) {
    const msg: MessageV2.User = {
      id: Identifier.ascending("message"),
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
      id: Identifier.ascending("part"),
      messageID: msg.id,
      sessionID: input.sessionID,
      type: "text",
      text: input.text,
      synthetic: input.synthetic ?? true,
    } satisfies MessageV2.TextPart)
  }

  function prompt(input: { sessionID: string; abort: AbortSignal }) {
    const promise = Question.ask({
      sessionID: input.sessionID,
      questions: [
        {
          question: "Ready to implement?",
          header: "Implement",
          custom: true,
          options: [
            {
              label: ANSWER_NEW_SESSION,
              description: "Implement in a fresh session with a clean context",
            },
            {
              label: ANSWER_CONTINUE,
              description: "Implement the plan in this session",
            },
          ],
        },
      ],
    })

    const listener = () =>
      Question.list().then((qs) => {
        const match = qs.find((q) => q.sessionID === input.sessionID)
        if (match) Question.reject(match.id)
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
    sessionID: string
    plan: string
    messages: MessageV2.WithParts[]
    model: MessageV2.User["model"]
    abort?: AbortSignal
  }) {
    const [handover, todos] = await Promise.all([
      generateHandover({ messages: input.messages, model: input.model, abort: input.abort }),
      Todo.get(input.sessionID),
    ])

    const sections = [`Implement the following plan:\n\n${input.plan}`]

    if (handover) {
      sections.push(`## Handover from Planning Session\n\n${handover}`)
    }

    const todoList = formatTodos(todos)
    if (todoList) {
      sections.push(`## Todo List\n\n${todoList}`)
    }

    const next = await Session.create({})
    await inject({
      sessionID: next.id,
      agent: "code",
      model: input.model,
      text: sections.join("\n\n"),
      synthetic: false,
    })
    if (todos.length) {
      await Todo.update({ sessionID: next.id, todos })
    }
    await Bus.publish(TuiEvent.SessionSelect, { sessionID: next.id })
    void import("@/session/prompt")
      .then((item) => item.SessionPrompt.loop({ sessionID: next.id }))
      .catch((error) => {
        log.error("failed to start follow-up session", { sessionID: next.id, error })
      })
  }

  export async function ask(input: {
    sessionID: string
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
      await inject({
        sessionID: input.sessionID,
        agent: "code",
        model: user.model,
        text: "Implement the plan above.",
      })
      return "continue"
    }

    Telemetry.trackPlanFollowup(input.sessionID, "custom")
    await inject({
      sessionID: input.sessionID,
      agent: "plan",
      model: user.model,
      text: answer,
    })
    return "continue"
  }
}
