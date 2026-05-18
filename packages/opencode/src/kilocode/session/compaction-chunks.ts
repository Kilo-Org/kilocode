import { Effect } from "effect"
import type { Agent } from "@/agent/agent"
import type { Config } from "@/config/config"
import type { Provider } from "@/provider/provider"
import type { LLM } from "@/session/llm"
import { MessageV2 } from "@/session/message-v2"
import { usable } from "@/session/overflow"
import type { SessionProcessor } from "@/session/processor"
import { MessageID, PartID, type SessionID } from "@/session/schema"
import type { Session } from "@/session/session"
import { Token } from "@/util/token"
import * as Log from "@opencode-ai/core/util/log"

type Update = <T extends MessageV2.Part>(part: T) => Effect.Effect<T>
type UpdateMessage = <T extends MessageV2.Info>(msg: T) => Effect.Effect<T>

const log = Log.create({ service: "kilocode.compaction.chunks" })
const TOOL_OUTPUT_MAX_CHARS = 2_000
const TRANSCRIPT_MAX_CHARS = 16_000
const RATIO = 0.6
const CONCURRENCY = 3
const DEPTH = 3
const OUTPUT = 2_048

export namespace KiloCompactionChunks {
  type Chunk = {
    index: number
    messages: MessageV2.WithParts[]
  }

  type Output = {
    result: SessionProcessor.Result
    output: string | undefined
  }

  type Deps = {
    processors: SessionProcessor.Interface
    session: Pick<Session.Interface, "updateMessage" | "updatePart" | "removeMessage">
  }

  type Input = Deps & {
    user: MessageV2.User
    agent: Agent.Info
    sessionID: SessionID
    model: Provider.Model
    cfg: Config.Info
    messages: MessageV2.WithParts[]
    prompt: string
    target: MessageV2.Assistant
    updateMessage: UpdateMessage
    updatePart: Update
  }

  type Replay = {
    info: MessageV2.User
    parts: MessageV2.Part[]
  }

  export function eligible(input: { result: SessionProcessor.Result; error: MessageV2.Assistant["error"] }) {
    if (input.result === "compact") return true
    return input.result === "stop" && input.error?.name === "ContextOverflowError"
  }

  export function needed(input: { cfg: Config.Info; model: Provider.Model; tokens: number }) {
    // Apply 1.3x multiplier to token estimate to compensate for Token.estimate
    // under-counting actual provider tokenizer counts by ~15-30%.
    return Math.ceil(input.tokens * 1.3) + model(input.model).limit.output > usable({ cfg: input.cfg, model: model(input.model) })
  }

  export function replay(input: Input & { replay: Replay }) {
    return Effect.gen(function* () {
      const chunk: Chunk = {
        index: 0,
        messages: [{ info: input.replay.info, parts: input.replay.parts }],
      }
      const size = budget({ cfg: input.cfg, model: input.model })
      if (!(yield* large({ messages: chunk.messages, model: input.model, size }))) return input.replay
      const result = yield* summarize({ ...input, chunk, total: 1 })
      if (result.result !== "continue" || !result.output) return input.replay
      return {
        info: input.replay.info,
        parts: [
          {
            id: PartID.ascending(),
            messageID: input.replay.info.id,
            sessionID: input.sessionID,
            type: "text" as const,
            synthetic: true,
            text: [
              "The original replayed request was too large to send after compaction.",
              "Use this compacted representation of that request instead:",
              result.output,
            ].join("\n\n"),
          },
        ],
      } satisfies Replay
    })
  }

  function budget(input: { cfg: Config.Info; model: Provider.Model }) {
    return Math.max(1_000, Math.floor(usable({ cfg: input.cfg, model: model(input.model) }) * RATIO))
  }

  function model(input: Provider.Model) {
    return {
      ...input,
      limit: {
        ...input.limit,
        output: Math.min(input.limit.output, OUTPUT),
      },
    } satisfies Provider.Model
  }

  function large(input: { messages: MessageV2.WithParts[]; model: Provider.Model; size: number }) {
    return estimate({ messages: input.messages, model: input.model }).pipe(Effect.map((count) => count > input.size))
  }

  function estimate(input: { messages: MessageV2.WithParts[]; model: Provider.Model }) {
    return Effect.gen(function* () {
      const msgs = yield* MessageV2.toModelMessagesEffect(input.messages, input.model, {
        stripMedia: true,
        toolOutputMaxChars: TOOL_OUTPUT_MAX_CHARS,
      })
      return Token.estimate(JSON.stringify(msgs))
    })
  }

  export function split(input: { messages: MessageV2.WithParts[]; model: Provider.Model; size: number }) {
    return Effect.gen(function* () {
      const chunks: Chunk[] = []
      let buf: MessageV2.WithParts[] = []
      for (const msg of input.messages) {
        const next = [...buf, msg]
        const size = yield* estimate({ messages: next, model: input.model })
        if (buf.length && size > input.size) {
          chunks.push({ index: chunks.length, messages: buf })
          buf = [msg]
          continue
        }
        buf = next
      }
      if (buf.length) chunks.push({ index: chunks.length, messages: buf })
      return chunks
    })
  }

  function text(msg: MessageV2.Assistant, parts: MessageV2.Part[]) {
    return parts
      .filter((part): part is MessageV2.TextPart => part.type === "text" && part.messageID === msg.id)
      .map((part) => part.text.trim())
      .filter(Boolean)
      .join("\n\n")
      .trim()
  }

  function clip(input: { text: string; chars: number; label: string }) {
    if (input.text.length <= input.chars) return input.text
    const cut = input.text.length - input.chars
    return `${input.text.slice(0, input.chars)}\n[${input.label} truncated for compaction: omitted ${cut} chars]`
  }

  function part(part: MessageV2.Part) {
    if (part.type === "text") return clip({ text: part.text, chars: TRANSCRIPT_MAX_CHARS, label: "Text" })
    if (part.type === "reasoning") return `[Reasoning]: ${clip({ text: part.text, chars: TRANSCRIPT_MAX_CHARS, label: "Reasoning" })}`
    if (part.type === "file") return `[File attachment]: ${part.filename ?? part.url} (${part.mime})`
    if (part.type === "agent") return `[Agent]: ${part.name}`
    if (part.type === "subtask") return `[Subtask ${part.agent}]: ${part.description}\n${clip({ text: part.prompt, chars: TRANSCRIPT_MAX_CHARS, label: "Subtask prompt" })}`
    if (part.type === "tool") {
      const head = `[Tool ${part.tool} ${part.state.status}]`
      if (part.state.status === "completed") {
        return [
          head,
          `input: ${clip({ text: JSON.stringify(part.state.input), chars: TOOL_OUTPUT_MAX_CHARS, label: "Tool input" })}`,
          `output: ${clip({ text: part.state.output, chars: TOOL_OUTPUT_MAX_CHARS, label: "Tool output" })}`,
        ].join("\n")
      }
      if (part.state.status === "error") return `${head}\n${clip({ text: part.state.error, chars: TOOL_OUTPUT_MAX_CHARS, label: "Tool error" })}`
      return `${head}\ninput: ${clip({ text: JSON.stringify(part.state.input), chars: TOOL_OUTPUT_MAX_CHARS, label: "Tool input" })}`
    }
    if (part.type === "step-finish") return `[Step finished]: ${part.reason}`
    if (part.type === "compaction") return "[Compaction requested]"
    return `[${part.type}]`
  }

  function transcript(input: { messages: MessageV2.WithParts[] }) {
    return input.messages
      .map((msg, index) => {
        const body = msg.parts
          .map(part)
          .filter(Boolean)
          .join("\n\n")
        return [`<message index=\"${index + 1}\" role=\"${msg.info.role}\">`, body || "[no content]", "</message>"].join("\n")
      })
      .join("\n\n")
  }

  function prompt(input: { chunk: Chunk; total: number }) {
    return [
      `Summarize conversation chunk ${input.chunk.index + 1} of ${input.total}.`,
      "Only summarize facts present in this chunk.",
      "Preserve concrete file paths, commands, errors, decisions, and unresolved tasks.",
      "Use terse Markdown bullets. Do not mention chunking or compaction.",
    ].join("\n")
  }

  function messages(input: { summaries: string[] }) {
    return input.summaries.map((summary, index) => ({
      role: "user" as const,
      content: [
        {
          type: "text" as const,
          text: [`<partial-summary index=\"${index + 1}\">`, summary, "</partial-summary>"].join("\n"),
        },
      ],
    }))
  }

  function assistant(input: { base: MessageV2.Assistant; sessionID: SessionID }) {
    return {
      ...input.base,
      id: MessageID.ascending(),
      parentID: input.base.parentID,
      sessionID: input.sessionID,
      cost: 0,
      tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: Date.now() },
      finish: undefined,
      error: undefined,
    } satisfies MessageV2.Assistant
  }

  function run(input: Input & { data: LLM.StreamInput["messages"]; text: string }) {
    return Effect.gen(function* () {
      const msg = yield* input.session.updateMessage(assistant({ base: input.target, sessionID: input.sessionID }))
      const mdl = model(input.model)
      const worker = yield* input.processors.create({ assistantMessage: msg, sessionID: input.sessionID, model: mdl })
      const opts = input.agent.options
      const agent = {
        ...input.agent,
        options: {
          ...opts,
          maxOutputTokens: Math.min(
            OUTPUT,
            typeof opts?.maxOutputTokens === "number" ? opts.maxOutputTokens : OUTPUT,
          ),
        },
      }
      const out = yield* Effect.gen(function* () {
        const result = yield* worker.process({
          user: input.user,
          agent,
          sessionID: input.sessionID,
          tools: {},
          system: [],
          messages: [...input.data, { role: "user", content: [{ type: "text", text: input.text }] }],
          model: mdl,
        })
        const parts = MessageV2.parts(worker.message.id)
        return { result, output: text(worker.message, parts) }
      }).pipe(
        Effect.ensuring(
          input.session.removeMessage({ sessionID: input.sessionID, messageID: worker.message.id }).pipe(Effect.ignore),
        ),
      )
      const result = out.result
      const output = out.output
      if (result !== "continue") return { result, output: undefined }
      if (!output) return { result: "stop" as const, output: undefined }
      return { result, output }
    })
  }

  function summarize(input: Input & { chunk: Chunk; total: number }) {
    return Effect.gen(function* () {
      const size = budget({ cfg: input.cfg, model: input.model })
      const data = (yield* large({ messages: input.chunk.messages, model: input.model, size }))
        ? [
            {
              role: "user" as const,
              content: [
                {
                  type: "text" as const,
                  text: [
                    "The following compacted transcript represents an oversized conversation chunk.",
                    "Summarize only facts present in the transcript.",
                    "<conversation>",
                    transcript({ messages: input.chunk.messages }),
                    "</conversation>",
                  ].join("\n"),
                },
              ],
            },
          ]
        : yield* MessageV2.toModelMessagesEffect(input.chunk.messages, input.model, {
            stripMedia: true,
            toolOutputMaxChars: TOOL_OUTPUT_MAX_CHARS,
          })
      return yield* run({ ...input, data, text: prompt({ chunk: input.chunk, total: input.total }) })
    })
  }

  function reduce(input: Input & { summaries: string[]; depth: number }): Effect.Effect<Output> {
    return Effect.gen(function* () {
      const result = yield* run({ ...input, data: messages({ summaries: input.summaries }), text: input.prompt })
      if (result.result === "continue") return result
      if (input.depth >= DEPTH || input.summaries.length <= 1) return result

      const size = Math.ceil(input.summaries.length / 2)
      const groups = Array.from({ length: Math.ceil(input.summaries.length / size) }, (_, index) =>
        input.summaries.slice(index * size, index * size + size),
      )
      const next: Output[] = yield* Effect.forEach(
        groups,
        (group) => reduce({ ...input, summaries: group, depth: input.depth + 1 }),
        { concurrency: 1 },
      )
      if (next.some((item) => item.result !== "continue" || !item.output)) return result
      return yield* reduce({ ...input, summaries: next.map((item) => item.output!), depth: input.depth + 2 })
    })
  }

  export function process(input: Input) {
    return Effect.gen(function* () {
      const size = budget({ cfg: input.cfg, model: input.model })
      const chunks = yield* split({ messages: input.messages, model: input.model, size })
      log.info("fallback", { chunks: chunks.length, concurrency: CONCURRENCY })

      const partial = yield* Effect.forEach(
        chunks,
        (chunk) => summarize({ ...input, chunk, total: chunks.length }),
        { concurrency: Math.min(CONCURRENCY, chunks.length) },
      )
      if (partial.some((item) => item.result !== "continue" || !item.output)) return "compact" as const

      const final = chunks.length === 1 && (yield* large({ messages: chunks[0].messages, model: input.model, size }))
        ? partial[0]
        : yield* reduce({ ...input, summaries: partial.map((item) => item.output!), depth: 0 })
      if (!final || final.result !== "continue" || !final.output) return "compact" as const

      yield* input.updatePart({
        id: PartID.ascending(),
        messageID: input.target.id,
        sessionID: input.sessionID,
        type: "text",
        text: final.output,
      })
      input.target.finish = "stop"
      input.target.error = undefined
      input.target.time.completed = Date.now()
      yield* input.updateMessage(input.target)
      return "continue" as const
    })
  }
}
