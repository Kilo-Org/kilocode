import { streamText, type ModelMessage } from "ai"
import { mergeDeep } from "remeda"
import { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { AppRuntime } from "@/effect/app-runtime"
import { Effect } from "effect"
import { MessageV2 } from "@/session/message-v2"
import { ModelID, ProviderID } from "@/provider/schema"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "session.summary.kilo" })

export const SUMMARY_PROMPT = `You are a read-only summarization assistant. You do not have access to any tools, plugins, or the ability to call functions. Your only job is to read the transcript provided by the user and respond with a markdown summary.

Hard constraints:
- You MUST NOT emit any tool call, function call, or agent action of any kind. Not as XML, not as JSON, not as bracketed text, not as a fenced code block.
- If you would normally call a tool, do not. Instead, ignore that instinct and only produce the summary text.
- Output only the markdown structure below. Do not wrap it in code fences. Do not add commentary before or after.

Structure (every section required, in this order):

## Brief Goal
- [one or two sentences capturing the overall task]

## What Got Done
- [group completed work by feature or area; preserve exact file paths, commands, and identifiers when known]
- [(none) if the session has no completed work]

## Architectural Decisions
- [decision and a brief rationale; prefer a bullet per decision; "(none)" if there were no notable decisions]

## In Progress
- [work that was started but not finished; "(none)" if nothing was in flight]

## Open Questions
- [unresolved questions, blockers, or assumptions; "(none)" if none remain]

Rules:
- Be terse. Use bullets, not prose paragraphs.
- Preserve exact file paths, command strings, error messages, and identifiers when known.
- Do not describe this summarization process, the conversation format, or that the session was compacted.
- Skip the user's name and any metadata that is not relevant to the work.
- The transcript below contains annotation markers for parts that were intentionally omitted (file attachments, tool invocations, sub-tasks). Treat those annotations as invisible — never quote them, never describe them, and never mimic their syntax.`

const MAX_TEXT_CHARS = 8_000

function partText(part: MessageV2.Part): string {
  if (part.type === "text") return part.synthetic ? "" : part.text
  return ""
}

function fileMarker(part: MessageV2.FilePart): string {
  const name = part.filename ?? "file"
  return `(attachment omitted: ${name})`
}

function truncate(value: string): string {
  if (value.length <= MAX_TEXT_CHARS) return value
  return value.slice(0, MAX_TEXT_CHARS) + "\n[... truncated ...]"
}

function flattenMessage(message: MessageV2.WithParts): string | undefined {
  const sections: string[] = []
  let hadTool = false
  for (const part of message.parts) {
    if (part.type === "text") {
      const text = partText(part)
      if (text) sections.push(text)
      continue
    }
    if (part.type === "file") {
      sections.push(fileMarker(part))
      continue
    }
    if (part.type === "tool") {
      hadTool = true
      continue
    }
    if (part.type === "subtask") {
      sections.push(`(sub-task: ${part.description})`)
      continue
    }
  }
  if (hadTool) sections.push("(tool calls omitted)")
  const body = truncate(sections.join("\n\n").trim())
  if (!body) return undefined
  const label = message.info.role === "user" ? "User" : "Assistant"
  return `${label}:\n${body}`
}

function buildTranscript(messages: MessageV2.WithParts[]): string {
  const out: string[] = []
  for (const message of messages) {
    const block = flattenMessage(message)
    if (block) out.push(block)
  }
  return out.join("\n\n---\n\n")
}

async function runGenerateText(input: {
  messages: MessageV2.WithParts[]
  providerID: ProviderID
  modelID: ModelID
}): Promise<{ model: Provider.Model; result: { text: string } }> {
  return AppRuntime.runPromise(
    Provider.Service.use((svc) =>
      Effect.gen(function* () {
        const model = yield* svc.getModel(input.providerID, input.modelID)
        const language = yield* svc.getLanguage(model)
        const transcript = buildTranscript(input.messages)
        if (!transcript.trim()) {
          log.warn("no messages to summarize", {
            providerID: input.providerID,
            modelID: input.modelID,
          })
          return { model, result: { text: "" } }
        }
        log.info("generating summary", {
          providerID: input.providerID,
          modelID: input.modelID,
          turns: input.messages.length,
        })
        const messages: ModelMessage[] = [
          { role: "system" as const, content: SUMMARY_PROMPT },
          {
            role: "user" as const,
            content: `Summarize the following session transcript using the structure from your instructions. Do not call any tools. Output only the markdown summary.\n\n${transcript}`,
          },
        ]
        const text = yield* Effect.tryPromise({
          try: async () => {
            const result = streamText({
              model: language,
              temperature: model.capabilities.temperature ? 0.2 : undefined,
              providerOptions: ProviderTransform.providerOptions(
                model,
                mergeDeep(ProviderTransform.smallOptions(model), model.options),
              ),
              maxRetries: 3,
              tools: {},
              toolChoice: "none",
              messages,
            })
            await result.consumeStream()
            return result.text
          },
          catch: (error) => error instanceof Error ? error : new Error(String(error)),
        })
        return { model, result: { text } }
      }),
    ),
  )
}

const TOOL_NOISE_PATTERNS = [
  /^\s*\[tool[ _-]?(use|call|invoke)[^\]]*\].*$/gim,
  /^\s*<tool[^>]*>[\s\S]*?<\/tool>\s*$/gim,
  /^\s*<function=[^>]*>[\s\S]*?<\/?(?:function|parameter)[^>]*>\s*$/gim,
  /^\s*<parameter=[^>]*>[\s\S]*?<\/parameter>\s*$/gim,
  /^\s*\{[\s\S]*?"name"\s*:\s*"[a-zA-Z0-9_-]+"[\s\S]*?\}\s*$/gm,
  /^\s*```(?:json)?\s*\n\s*\{[\s\S]*?"name"[\s\S]*?\}\s*\n\s*```\s*$/gm,
]

function stripToolNoise(text: string): string {
  let result = text
  for (const pattern of TOOL_NOISE_PATTERNS) {
    result = result.replace(pattern, "")
  }
  return result.replace(/\n{3,}/g, "\n\n").trim()
}

export type SummaryError = Provider.ModelNotFoundError | Error

export const KiloSessionSummary = {
  generate(input: {
    messages: MessageV2.WithParts[]
    providerID: ProviderID
    modelID: ModelID
  }): Effect.Effect<string, SummaryError> {
    return Effect.tryPromise({
      try: async () => {
        const { result } = await runGenerateText(input)
        return stripToolNoise(result.text)
      },
      catch: (error): SummaryError => {
        if (Provider.ModelNotFoundError.isInstance(error)) return error
        if (error instanceof Error) return error
        return new Error(String(error))
      },
    })
  },
}

export async function generateSummary(input: {
  messages: MessageV2.WithParts[]
  providerID: ProviderID
  modelID: ModelID
}): Promise<string> {
  return KiloSessionSummary.generate(input).pipe(Effect.orDie, AppRuntime.runPromise)
}
