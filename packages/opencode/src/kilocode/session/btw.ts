import { Cause, Effect, Exit, Option, Schema } from "effect"
import { Storage } from "@/storage/storage"
import { Session } from "@/session/session"
import { Agent } from "@/agent/agent"
import { SessionStatus } from "@/session/status"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
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
import { AbortedError } from "@opencode-ai/core/v1/session"
import { errorMessage } from "@/util/error"

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

  // In-memory history used only when the Storage service is absent (bare
  // runtimes / tests). Bounded so it can never grow without limit.
  const memFallback = new Map<string, Entry[]>()
  const MEM_MAX_PARENTS = 100

  function stored(opt: Option.Option<Storage.Interface>, parentID: string) {
    if (Option.isNone(opt)) return Effect.succeed(memFallback.get(parentID) ?? ([] as Entry[]))
    return opt.value.read<Entry[]>(key(parentID)).pipe(Effect.catch(() => Effect.succeed([] as Entry[])))
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
    if (Option.isNone(opt)) {
      const existing = memFallback.get(input.parentID) ?? []
      const next = [entry, ...existing].slice(0, MAX_ENTRIES)
      memFallback.set(input.parentID, next)
      if (memFallback.size > MEM_MAX_PARENTS) {
        const oldest = memFallback.keys().next().value
        if (oldest !== undefined) memFallback.delete(oldest)
      }
      return entry
    }
    const existing = yield* stored(opt, input.parentID)
    const next = [entry, ...existing].slice(0, MAX_ENTRIES)
    yield* opt.value.write(key(input.parentID), next).pipe(
      Effect.catch((err) => Effect.logError("KiloBtw: failed to persist entry", err)),
    )
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
    model: { providerID: ProviderV2.ID; modelID: ModelV2.ID; variant?: string }
    variant?: string
    parts: Array<{ type: "text"; text: string }>
  }

  export interface Ops {
    sessions: Pick<
      Session.Interface,
      "fork" | "remove" | "get" | "touch" | "updateMessage" | "updatePart" | "setPermission"
    >
    agents: Pick<Agent.Interface, "defaultInfo">
    events: Pick<EventV2.Interface, "publish">
    status: Pick<SessionStatus.Interface, "get" | "set">
    currentModel: (sessionID: SessionID) => Effect.Effect<ModelRef>
    runFork: (input: ForkInput) => Effect.Effect<Exit.Exit<MessageV2.WithParts, unknown>>
  }

  // Tools a side question may use. Everything else — including all MCP
  // servers — is denied, and nothing resolves to "ask", so the fork can
  // never stall on a permission prompt the client cannot see.
  const ALLOWED_TOOLS = ["read", "grep", "glob", "list", "skill", "webfetch", "websearch", "semantic_search"]

  // Deny every tool first, then re-allow read/research tools. Permission
  // evaluation is last-match-wins, so the allows after the "*" deny win for
  // those tools. A tool the parent explicitly restricted (deny/ask rules)
  // keeps the parent's own rules instead of the blanket allow — a side
  // question can never grant access the parent did not have. Parent "ask"
  // rules are downgraded to "deny" (the fork cannot surface prompts).
  export function forkPermission(parentRules: PermissionV1.Ruleset | undefined): PermissionV1.Ruleset {
    const rules = parentRules ?? []
    const restricted = (tool: string) => rules.some((rule) => rule.permission === tool)
    return [
      { permission: "*", action: "deny", pattern: "*" },
      ...ALLOWED_TOOLS.flatMap((tool) => {
        if (!restricted(tool)) return [{ permission: tool, action: "allow" as const, pattern: "*" }]
        return rules
          .filter((rule) => rule.permission === tool)
          .map((rule) => ({ ...rule, action: rule.action === "allow" ? ("allow" as const) : ("deny" as const) }))
      }),
    ]
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
    messageID: Schema.optional(MessageID),
    variant: Schema.optional(Schema.String),
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
    // still rendering in the transcript. time.end is required by the CLI's
    // `run --command` text output path.
    const part: SessionV1.TextPart = yield* input.ops.sessions.updatePart({
      id: PartID.ascending(),
      messageID: info.id,
      sessionID: parent,
      type: "text",
      text: input.text,
      ignored: true,
      time: { start: now, end: now },
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
    messageID?: MessageID
    agent: string
    model: ModelRef
    text: string
  }) {
    const info: SessionV1.User = yield* input.ops.sessions.updateMessage({
      id: input.messageID ?? MessageID.ascending(),
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

    // Show the parent as busy while the side question runs so clients that
    // key off session status see the activity. Only claim an idle parent,
    // and only restore idle if we were the ones who set busy.
    const parentStatus = yield* ops.status.get(parent)
    const claimBusy = parentStatus.type === "idle"

    const runQuestion = Effect.fn("KiloBtw.runQuestion")(function* (question: string) {
      if (claimBusy) yield* ops.status.set(parent, { type: "busy" })

      if (!question) {
        const entries = yield* list(parent)
        const body = entries.length > 0 ? formatEntry(entries[0]) : formatUsage()
        const text = entries.length > 0 ? `**BTW** — last side question\n\n${body}` : body
        const user = yield* userMessage({
          ops,
          sessionID: parent,
          messageID: cmdInput.messageID,
          agent,
          model,
          text: "/btw",
        })
        return yield* emit({ ops, cmdInput, userID: user.id, agent, model, text })
      }

      const user = yield* userMessage({
        ops,
        sessionID: parent,
        messageID: cmdInput.messageID,
        agent,
        model,
        text: `/btw ${question}`,
      })

      // Run the fork with the session's agent: guardPermissions re-appends
      // session deny rules after agent rules for ask/plan/architect agents,
      // which would replay the allowlist's "*" deny last and disable every
      // tool. Primary-mode agents evaluate the fork's ruleset as-is
      // (findLast: rules after the "*" deny win), so only the read/research
      // tools — restricted by the parent's own rules where present — can
      // ever execute. No MCP tools, no permission stalls.
      const guarded = ["ask", "plan", "architect"]
      const forkAgent = guarded.includes(agent.toLowerCase()) ? fallback?.name ?? "build" : agent
      const variant = model.variant ?? cmdInput.variant

      // acquireUseRelease guarantees the fork is removed even if this fiber is
      // interrupted between fork creation and the prompt, or mid-prompt.
      // parentID registers the fork as a child session so stopping the parent
      // cancels the side question through the existing cancel tree; children:
      // false skips cloning the parent's task-subagent subtree for a side question.
      const exit = yield* Effect.acquireUseRelease(
        Effect.gen(function* () {
          const fork = yield* ops.sessions
            .fork({ sessionID: parent, parentID: parent, children: false })
            .pipe(Effect.orDie)
          setPromptCacheKey(fork.id, parent)
          yield* ops.sessions
            .setPermission({ sessionID: fork.id, permission: forkPermission(session.permission) })
            .pipe(Effect.orDie)
          return fork
        }),
        (fork) =>
          ops.runFork({
            sessionID: fork.id,
            agent: forkAgent,
            model: { providerID: model.providerID, modelID: model.modelID, variant },
            variant,
            parts: [
              {
                type: "text",
                text: `Side question — answer it concisely. Your tools are read-only; do not attempt to modify anything.\n\n${question}`,
              },
            ],
          }),
        (fork) =>
        Effect.gen(function* () {
          clearPromptCacheKey(fork.id)
          yield* waitForIdle(ops.status, fork.id)
          yield* ops.sessions.remove(fork.id).pipe(
            Effect.catch((err) => Effect.logError("KiloBtw: failed to remove fork", fork.id, err)),
          )
        }),
    )

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

      // An aborted turn returns successfully but carries an error on the
      // assistant message with whatever partial text the model produced.
      // Surface it as cancelled/failed instead of saving a partial answer.
      const result = exit.value
      if (result.info.role === "assistant" && result.info.error) {
        if (AbortedError.isInstance(result.info.error)) {
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
        return yield* fail(errorMessage(result.info.error))
      }

      const answer = result.parts
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

    return yield* runQuestion(question).pipe(
      Effect.ensuring(claimBusy ? ops.status.set(parent, { type: "idle" }) : Effect.void),
    )
  })
}
