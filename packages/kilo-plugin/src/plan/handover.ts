export * as PlanHandover from "./handover"

import type { Model } from "@opencode/schema/model"
import type { SessionMessage } from "@opencode/schema/session-message"
import { Duration, Effect, Option } from "effect"

export const PROMPT = `You are summarizing a planning session to hand off to an implementation session.

The plan itself will be provided separately. Do NOT repeat it. Instead, focus on information discovered during planning that would help the implementing agent but is NOT already in the plan text.

Produce a concise summary using this template:
---
## Discoveries

[Key findings from code exploration: architecture patterns, gotchas, edge cases, relevant existing code that the plan references but does not fully explain]

## Relevant Files

[Structured list of files and directories that were read or discussed, with brief notes on what is relevant in each]

## Implementation Notes

[Any important context: conventions to follow, potential pitfalls, dependencies between steps, things the implementing agent should watch out for]
---

If there is nothing useful to add beyond what the plan already says, respond with an empty string.
Keep the summary concise. Focus on high-entropy information that would save the implementing agent time.`

/** The planning transcript is bounded so a long session cannot exceed the summary model's context. */
const CHARS = 60_000
const TIMEOUT = Duration.seconds(60)

type Generate = (input: { prompt: string; system: string; model?: Model.Ref }) => Effect.Effect<string, unknown>

/**
 * A short summary of what planning discovered, for the implementation session. Empty when there is nothing to
 * add, when generation fails, or after the timeout: the handoff must not depend on it.
 */
export const generate = Effect.fn("PlanHandover.generate")(function* (input: {
  messages: ReadonlyArray<SessionMessage.Info>
  generate: Generate
  model?: Model.Ref
}) {
  const transcript = render(input.messages)
  if (!transcript) return ""
  const result = yield* input
    .generate({ prompt: transcript, system: PROMPT, ...(input.model ? { model: input.model } : {}) })
    .pipe(
      Effect.timeoutOption(TIMEOUT),
      Effect.catchCause((cause) =>
        Effect.logWarning("plan handover generation failed", { cause }).pipe(Effect.as(Option.none<string>())),
      ),
    )
  return Option.getOrElse(result, () => "").trim()
})

/** The user and assistant text of the session, newest kept when it exceeds the bound. */
export function render(messages: ReadonlyArray<SessionMessage.Info>) {
  const text = messages
    .flatMap((message) => {
      if (message.type === "user") return [`User: ${message.text}`]
      if (message.type !== "assistant") return []
      const parts = message.content.flatMap((part) => {
        if (part.type === "text") return [part.text]
        if (part.type === "tool") return [`[tool ${part.name}]`]
        return []
      })
      return parts.length ? [`Assistant: ${parts.join("\n")}`] : []
    })
    .join("\n\n")
    .trim()
  return text.length > CHARS ? text.slice(-CHARS) : text
}

/** The newest todo list of the planning session, as a Markdown checklist. */
export function todos(messages: ReadonlyArray<SessionMessage.Info>) {
  const latest = messages.toReversed().flatMap((message) => {
    if (message.type !== "assistant") return []
    return message.content.toReversed().flatMap((part) => {
      if (part.type !== "tool" || part.name !== "todowrite" || part.state.status !== "completed") return []
      const list = part.state.metadata?.["todos"]
      return Array.isArray(list) ? [list] : []
    })
  })[0]
  if (!latest) return ""
  const icons: Record<string, string> = { completed: "[x]", in_progress: "[~]", cancelled: "[-]" }
  return latest
    .flatMap((item: unknown) => {
      if (typeof item !== "object" || item === null || !("content" in item)) return []
      const status = "status" in item && typeof item.status === "string" ? item.status : ""
      return [`- ${icons[status] ?? "[ ]"} ${String(item.content)}`]
    })
    .join("\n")
}
