import { Cause, Effect, Exit, Option, Schema } from "effect"
import { Storage } from "@/storage/storage"
import { Session } from "@/session/session"
import { Agent } from "@/agent/agent"
import { SessionStatus } from "@/session/status"
import type { EventV2 } from "@opencode-ai/core/event"
import { InstanceState } from "@/effect/instance-state"
import { Command } from "@/command"
import { NamedError } from "@opencode-ai/core/util/error"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import type { MessageV2 } from "@/session/message-v2"
import { MessageID, PartID, SessionID } from "@/session/schema"
import type { ProviderV2 } from "@opencode-ai/core/provider"
import type { ModelV2 } from "@opencode-ai/core/model"
import { setPromptCacheKey, clearPromptCacheKey } from "./cache-key"
import { isInterrupted } from "@/kilocode/effect/cause"

export namespace KiloBtw {
  export const MAX_ENTRIES = 20
  export const MAX_QUESTION_CHARS = 8000
  export const MAX_ANSWER_CHARS = 20000

  export const Entry = Schema.Struct({
    id: Schema.String,
    parentID: Schema.String,
    question: Schema.String,
    answer: Schema.String,
    created: Schema.Number,
    model: Schema.optional(
      Schema.Struct({
        providerID: Schema.String,
        modelID: Schema.String,
      }),
    ),
  })
  export type Entry = Schema.Schema.Type<typeof Entry>

  function key(parentID: string) {
    return ["btw", parentID]
  }

  function trim(text: string, max: number) {
    if (text.length <= max) return text
    return text.slice(0, max) + "\n…[truncated]"
  }

  const memFallback = new Map<string, Entry[]>()

  function stored(opt: Option.Option<Storage.Interface>, parentID: string) {
    if (Option.isNone(opt)) return Effect.succeed(memFallback.get(parentID) ?? ([] as Entry[]))
    return opt.value.read<Entry[]>(key(parentID)).pipe(
      Effect.catch(() => Effect.succeed(memFallback.get(parentID) ?? ([] as Entry[]))),
    )
  }

  export const list = Effect.fn("KiloBtw.list")(function* (parentID: string) {
    const opt = yield* Effect.serviceOption(Storage.Service)
    return yield* stored(opt, parentID)
  })

  export const add = Effect.fn("KiloBtw.add")(function* (input: {
    parentID: string
    question: string
    answer: string
    model?: { providerID: string; modelID: string }
  }) {
    const entry: Entry = {
      id: `btw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      parentID: input.parentID,
      question: trim(input.question, MAX_QUESTION_CHARS),
      answer: trim(input.answer, MAX_ANSWER_CHARS),
      created: Date.now(),
      ...(input.model ? { model: input.model } : {}),
    }
    const opt = yield* Effect.serviceOption(Storage.Service)
    const existing = yield* stored(opt, input.parentID)
    const next = [entry, ...existing].slice(0, MAX_ENTRIES)
    memFallback.set(input.parentID, next)
    if (Option.isSome(opt)) {
      yield* opt.value.write(key(input.parentID), next).pipe(
        Effect.catch((err) => Effect.logError("KiloBtw: failed to persist entry", err)),
      )
    }
    return entry
  })

  export function formatUsage() {
    return [
      "Usage: /btw <question>",
      "Ask a side question without adding it to the conversation.",
      "The question runs in a temporary read-only fork with the current context, then the fork is deleted.",
      "Run /btw with no arguments to see the most recent side question.",
    ].join("\n")
  }

  export function formatEntry(entry: Entry) {
    const when = new Date(entry.created).toISOString()
    const model = entry.model ? `${entry.model.providerID}/${entry.model.modelID}` : "unknown model"
    return [`Q (${when} · ${model}): ${entry.question}`, "", `A: ${entry.answer}`].join("\n")
  }

  type ModelRef = { providerID: ProviderV2.ID; modelID: ModelV2.ID; variant?: string }

  export interface ForkInput {
    sessionID: SessionID
    agent: string
    model: { providerID: ProviderV2.ID; modelID: ModelV2.ID }
    tools: Record<string, boolean>
    parts: Array<{ type: "text"; text: string }>
  }

  export interface Ops {
    sessions: Pick<Session.Interface, "fork" | "remove" | "get" | "touch" | "updateMessage" | "updatePart">
    agents: Pick<Agent.Interface, "list" | "defaultInfo">
    events: Pick<EventV2.Interface, "publish">
    status: Pick<SessionStatus.Interface, "get">
    currentModel: (sessionID: SessionID) => Effect.Effect<ModelRef>
    runFork: (input: ForkInput) => Effect.Effect<Exit.Exit<MessageV2.WithParts, unknown>>
  }

  // Deny every mutating or interactive tool so a side question can never touch
  // the workspace or stall on a permission/question prompt the client cannot see.
  const DENY_ALL_MUTATING: Record<string, boolean> = {
    bash: false,
    edit: false,
    write: false,
    patch: false,
    task: false,
    question: false,
    interactive_terminal: false,
    background_process: false,
    browser: false,
  }

  const waitForIdle = Effect.fn("KiloBtw.waitForIdle")(function* (status: Ops["status"], sessionID: SessionID) {
    for (let i = 0; i < 100; i++) {
      const info = yield* status.get(sessionID)
      if (info.type === "idle") return
      yield* Effect.sleep(50)
    }
  })

  const commandInput = Schema.Struct({
    sessionID: SessionID,
    command: Schema.String,
    arguments: Schema.String,
  })
  export type CommandInput = Schema.Schema.Type<typeof commandInput>

  const emit = Effect.fn("KiloBtw.emit")(function* (input: {
    ops: Ops
    cmdInput: CommandInput
    userID: MessageID
    agent: string
    model: ModelRef
    text: string
    errorText?: string
  }) {
    const parent = input.cmdInput.sessionID
    const ctx = yield* InstanceState.context
    const now = Date.now()
    const info: SessionV1.Assistant = yield* input.ops.sessions.updateMessage({
      id: MessageID.ascending(),
      role: "assistant",
      parentID: input.userID,
      sessionID: parent,
      mode: input.agent,
      agent: input.agent,
      path: { cwd: ctx.directory, root: ctx.worktree },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: input.model.modelID,
      providerID: input.model.providerID,
      time: { created: now, completed: now },
      finish: input.errorText ? "error" : "stop",
      ...(input.errorText
        ? { error: new NamedError.Unknown({ message: input.errorText }).toObject() as SessionV1.Assistant["error"] }
        : {}),
    })
    // ignored: true keeps the side Q&A out of every future model request while
    // still rendering in the transcript.
    const part: SessionV1.TextPart = yield* input.ops.sessions.updatePart({
      id: PartID.ascending(),
      messageID: info.id,
      sessionID: parent,
      type: "text",
      text: input.text,
      ignored: true,
    })
    yield* input.ops.sessions.touch(parent)
    yield* input.ops.events.publish(Command.Event.Executed, {
      name: input.cmdInput.command,
      sessionID: parent,
      arguments: input.cmdInput.arguments,
      messageID: info.id,
    })
    return { info, parts: [part] }
  })

  const userMessage = Effect.fn("KiloBtw.userMessage")(function* (input: {
    ops: Ops
    sessionID: SessionID
    agent: string
    model: ModelRef
    text: string
  }) {
    const info: SessionV1.User = yield* input.ops.sessions.updateMessage({
      id: MessageID.ascending(),
      role: "user",
      sessionID: input.sessionID,
      time: { created: Date.now() },
      agent: input.agent,
      model: { providerID: input.model.providerID, modelID: input.model.modelID },
    })
    yield* input.ops.sessions.updatePart({
      id: PartID.ascending(),
      messageID: info.id,
      sessionID: input.sessionID,
      type: "text",
      text: input.text,
      ignored: true,
    })
    return info
  })

  export const command = Effect.fn("KiloBtw.command")(function* (input: { cmdInput: CommandInput; ops: Ops }) {
    const { cmdInput, ops } = input
    const parent = cmdInput.sessionID
    const question = cmdInput.arguments.trim()

    const session = yield* ops.sessions.get(parent)
    const fallback = yield* ops.agents.defaultInfo()
    const agent = session.agent ?? fallback?.name ?? "build"
    const model = yield* ops.currentModel(parent)

    if (!question) {
      const entries = yield* list(parent)
      const body = entries.length > 0 ? formatEntry(entries[0]) : formatUsage()
      const text = entries.length > 0 ? `**BTW** — last side question\n\n${body}` : body
      const user = yield* userMessage({ ops, sessionID: parent, agent, model, text: "/btw" })
      return yield* emit({ ops, cmdInput, userID: user.id, agent, model, text })
    }

    const user = yield* userMessage({ ops, sessionID: parent, agent, model, text: `/btw ${question}` })

    const listed = yield* ops.agents.list()
    const ask = listed.find((a) => a.name === "ask" && !a.hidden)
    const forkAgent = ask ? "ask" : agent
    // Hard denies on top of the ask agent so a user-modified ask config can
    // never reopen mutating or interactive tools for a side question.
    const forkTools = { ...DENY_ALL_MUTATING }

    const fork = yield* ops.sessions.fork({ sessionID: parent }).pipe(Effect.orDie)
    setPromptCacheKey(fork.id, parent)

    const cleanup = Effect.gen(function* () {
      clearPromptCacheKey(fork.id)
      yield* waitForIdle(ops.status, fork.id)
      yield* ops.sessions.remove(fork.id).pipe(
        Effect.catch((err) => Effect.logError("KiloBtw: failed to remove fork", fork.id, err)),
      )
    })

    const exit = yield* ops
      .runFork({
        sessionID: fork.id,
        agent: forkAgent,
        model: { providerID: model.providerID, modelID: model.modelID },
        tools: forkTools,
        parts: [{ type: "text", text: question }],
      })
      .pipe(Effect.ensuring(cleanup))

    const fail = (message: string) =>
      Effect.gen(function* () {
        yield* ops.events.publish(Session.Event.Error, {
          sessionID: parent,
          error: new NamedError.Unknown({ message: `btw: ${message}` }).toObject(),
        })
        return yield* emit({ ops, cmdInput, userID: user.id, agent, model, text: `BTW failed: ${message}`, errorText: `btw: ${message}` })
      })

    if (Exit.isFailure(exit)) {
      if (isInterrupted(exit.cause)) {
        return yield* emit({
          ops,
          cmdInput,
          userID: user.id,
          agent,
          model,
          text: "Side question cancelled.",
          errorText: "btw cancelled",
        })
      }
      const err = Cause.squash(exit.cause)
      return yield* fail(err instanceof Error ? err.message : String(err))
    }

    const answer = exit.value.parts
      .filter((p): p is MessageV2.TextPart => p.type === "text" && !p.ignored)
      .map((p) => p.text)
      .join("\n\n")
      .trim()

    if (!answer) {
      return yield* fail("the model returned no text")
    }

    yield* add({
      parentID: parent,
      question,
      answer,
      model: { providerID: model.providerID, modelID: model.modelID },
    })

    const text = [
      `**BTW** — side question (read-only, not added to the conversation)`,
      ``,
      `**Q:** ${question}`,
      ``,
      answer,
    ].join("\n")

    return yield* emit({ ops, cmdInput, userID: user.id, agent, model, text })
  })
}
