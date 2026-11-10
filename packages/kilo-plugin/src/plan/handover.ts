export * as PlanHandover from "./handover"

import type { Model } from "@opencode/schema/model"
import type { SessionMessage } from "@opencode/schema/session-message"
import { Cause, Duration, Effect, Option } from "effect"

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

The transcript below is planning context. Lines starting with [tool ...] hold raw tool arguments and output: use them
only as evidence for the sections above. Never copy, quote or reformat a [tool ...] line, never paste file contents,
and never describe or perform implementation work. Output only the template sections, or an empty string.

If there is nothing useful to add beyond what the plan already says, respond with an empty string.
Keep the summary concise. Focus on high-entropy information that would save the implementing agent time.`

/** The planning transcript is bounded so a long session cannot exceed the summary model's context. */
const CHARS = 60_000
/** Each tool call keeps its input and the start of its output, so file reads ground the summary in real code. */
const TOOL_CHARS = 4_000
const TIMEOUT = Duration.seconds(60)


/** A timed-out attempt is final; a provider failure may be retried once on the default model. */
type Attempt = { readonly text: Option.Option<string>; readonly retry: boolean }

type Generate = (input: { prompt: string; system: string; model?: Model.Ref }) => Effect.Effect<string, unknown>

/**
 * A short summary of what planning discovered, for the implementation session. Empty when there is nothing to
 * add, when generation fails, or after the timeout: the handoff must not depend on it. A user interruption is not a
 * generation failure and stops the handoff.
 */
export const generate = Effect.fn("PlanHandover.generate")(function* (input: {
  messages: ReadonlyArray<SessionMessage.Info>
  generate: Generate
  model?: Model.Ref
  /** Overrides the per-attempt budget. Tests use a short value. */
  timeout?: Duration.Duration
}) {
  const transcript = render(input.messages)
  if (!transcript) return ""
  const attempt = (model?: Model.Ref): Effect.Effect<Attempt> =>
    input
      .generate({ prompt: transcript, system: PROMPT, ...(model ? { model } : {}) })
      .pipe(
        Effect.map((text): Attempt => ({ text: Option.some(text), retry: false })),
        Effect.timeoutOrElse({
          duration: input.timeout ?? TIMEOUT,
          orElse: (): Effect.Effect<Attempt> =>
            Effect.succeed({ text: Option.none<string>(), retry: false } satisfies Attempt),
        }),
        Effect.catchCause((cause) =>
          Cause.hasInterrupts(cause)
            ? Effect.interrupt
            : Effect.logWarning("plan handover generation failed", { cause }).pipe(
                Effect.as({ text: Option.none<string>(), retry: true } satisfies Attempt),
              ),
        ),
      )
  // A model-specific provider error falls back once to the default model. An empty summary is a result, not a failure.
  const first = yield* attempt(input.model)
  const result = first.retry && input.model !== undefined ? yield* attempt() : first
  return clean(Option.getOrElse(result.text, () => "").trim())
})

/** Drops an echoed tool line, so a transcript template cannot leak raw tool arguments into the handover. */
function clean(text: string) {
  return text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("[tool "))
    .join("\n")
    .trim()
}

/** The user and assistant text and the tool calls of the session, newest kept when it exceeds the bound. */
export function render(messages: ReadonlyArray<SessionMessage.Info>) {
  const text = messages
    .flatMap((message) => {
      if (message.type === "user") return [`User: ${message.text}`]
      if (message.type !== "assistant") return []
      const parts = message.content.flatMap((part) => {
        if (part.type === "text") return [part.text]
        if (part.type === "tool") return [tool(part)]
        return []
      })
      return parts.length ? [`Assistant: ${parts.join("\n")}`] : []
    })
    .join("\n\n")
    .trim()
  return text.length > CHARS ? text.slice(-CHARS) : text
}

function tool(part: SessionMessage.AssistantTool) {
  const state = part.state
  const input = typeof state.input === "string" ? state.input : JSON.stringify(state.input)
  const output =
    state.status === "completed" || state.status === "error"
      ? (state.content ?? []).flatMap((content) => (content.type === "text" ? [content.text] : [])).join("\n")
      : ""
  const text = [`[tool ${part.name}] ${input}`, ...(output ? [output] : [])].join("\n")
  return text.length > TOOL_CHARS ? `${text.slice(0, TOOL_CHARS)}\n[truncated]` : text
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
