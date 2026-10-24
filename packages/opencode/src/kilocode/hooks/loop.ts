import { eq } from "drizzle-orm"
import { Effect, Option } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import type { EventV2 } from "@opencode-ai/core/event"
import type { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { SessionTable } from "@opencode-ai/core/session/sql"
import * as Log from "@opencode-ai/core/util/log"
import { Config } from "@/config/config"
import { KiloSession } from "@/kilocode/session"
import { KiloSessionPromptQueue } from "@/kilocode/session/prompt-queue"
import { Wakeup } from "@/kilocode/wakeup"
import { MessageV2 } from "@/session/message-v2"
import type { SessionProcessor } from "@/session/processor"
import type { SessionPrompt } from "@/session/prompt"
import { MessageID, PartID, type SessionID } from "@/session/schema"
import type { Session } from "@/session/session"
import { isRecord } from "@/util/record"
import type { Event } from "./events"
import { KiloHooks } from "./hooks"
import { KiloHookPayload } from "./payload"

// Agent loop events: Stop, SubagentStop, SubagentStart, PostToolBatch, and the per-turn state the
// loop's hooks share: the halt tool hooks set with `continue: false`, auto-compaction vetoes, and
// the turn each Stop continuation belongs to.

const log = Log.create({ service: "hooks" })

const LIMIT = 1024 // sessions or messages remembered by each map
const VETOES = 256 // turns whose auto-compaction veto is remembered
const DEPTH = 16 // session ancestry walked to find the root session

type Services = { config: Config.Interface; database: Database.Interface }

/** Where a session sits for hook input: its root and parent session, agent, directory and rules. */
type Lineage = {
  root: string
  parent?: string
  agent?: string
  directory?: string
  permission?: PermissionV1.Ruleset
}

/** The session's hooks for an event (empty when none is configured anywhere); fails open. */
function resolve(sessionID: SessionID, event: Event, input: Services) {
  return KiloHooks.resolve(sessionID, event).pipe(
    Effect.provideService(Config.Service, input.config),
    Effect.provideService(Database.Service, input.database),
    Effect.catchCause((cause) => {
      log.warn("could not resolve hooks", { event, sessionID, cause: String(cause) })
      return Effect.succeed({} as KiloHooks.Hooks)
    }),
  )
}

function root(session: Session.Info, sessions: Pick<Session.Interface, "get">) {
  if (!session.parentID) return Effect.succeed(session.id)
  return KiloHookPayload.root(session.id, sessions)
}

/** The session fields hook payloads need, read straight from the database. */
function row(database: Database.Interface, id: SessionID) {
  return database.db
    .select({
      parent: SessionTable.parent_id,
      agent: SessionTable.agent,
      directory: SessionTable.directory,
      permission: SessionTable.permission,
    })
    .from(SessionTable)
    .where(eq(SessionTable.id, id))
    .get()
    .pipe(
      Effect.orDie,
      Effect.catchCause((cause) => {
        log.warn("could not read a session for hook input", { sessionID: id, cause: String(cause) })
        return Effect.succeed(undefined)
      }),
    )
}

/**
 * A session's root, parent, agent, directory and permission rules for hook input. Read from the
 * database when it is at hand (it survives restarts, so a subagent still reports its root session
 * after one), remembering the ancestry in memory; else from Kilo's in-memory session ancestry.
 */
export const lineage = Effect.fn("KiloHookLoop.lineage")(function* (
  sessionID: SessionID,
  database?: Database.Interface,
) {
  const memory: Lineage = { root: KiloSession.resolveRoot(sessionID), parent: KiloSession.resolveParent(sessionID) }
  const db = database ?? Option.getOrUndefined(yield* Effect.serviceOption(Database.Service))
  const info = db ? yield* row(db, sessionID) : undefined
  if (!db || !info) return memory
  const found: Lineage = {
    root: sessionID,
    parent: info.parent ?? undefined,
    agent: info.agent ?? undefined,
    directory: info.directory,
    permission: info.permission ?? undefined,
  }
  if (!info.parent) return found
  if (memory.root !== sessionID) return { ...found, root: memory.root }
  const chain: { id: SessionID; parent?: SessionID }[] = [{ id: sessionID, parent: info.parent }]
  while (chain.length < DEPTH) {
    const last = chain.at(-1)
    if (!last?.parent) break
    const next = yield* row(db, last.parent)
    if (!next) break
    chain.push({ id: last.parent, parent: next.parent ?? undefined })
  }
  for (const item of chain.toReversed()) {
    if (item.parent) KiloSession.register({ id: item.id, parentID: item.parent })
  }
  return { ...found, root: chain.at(-1)?.id ?? sessionID }
})

// The turn each Stop / SubagentStop continuation message belongs to: its root user message.
const turns = new Map<string, string>()

/** The root user message of the turn a user message belongs to: itself unless it is a continuation. */
function turn(user: string) {
  return turns.get(user) ?? user
}

// Auto-compaction vetoes by the turn's root user message, so PreCompact runs at most once per turn,
// Stop continuations included.
const vetoes = new Map<string, string>()

/** Remembers that a PreCompact hook vetoed auto-compaction for the turn of user message `user`. */
export function veto(user: string, reason: string): void {
  KiloHooks.keep(vetoes, turn(user), reason, VETOES)
}

/** The reason a PreCompact hook vetoed auto-compaction for the turn of `user`, if one did. */
export function vetoed(user: string | undefined): string | undefined {
  if (user === undefined) return undefined
  return vetoes.get(turn(user))
}

const CONTINUATIONS = new Set(["Stop", "SubagentStop"])

/** The Stop / SubagentStop continuation tag of a part (`metadata.hook`), if it carries one. */
function continuation(part: MessageV2.Part) {
  if (part.type !== "text" || !isRecord(part.metadata) || !isRecord(part.metadata.hook)) return undefined
  const hook = part.metadata.hook
  if (typeof hook.event !== "string" || !CONTINUATIONS.has(hook.event)) return undefined
  return { event: hook.event, streak: typeof hook.streak === "number" ? hook.streak : 0 }
}

/** The consecutive continuation cap (Claude Code's CLAUDE_CODE_STOP_HOOK_BLOCK_CAP, default 8). */
function cap() {
  return Number(process.env.KILO_STOP_HOOK_BLOCK_CAP ?? process.env.CLAUDE_CODE_STOP_HOOK_BLOCK_CAP) || 8
}

/** The assistant's last text a user would read: not synthetic, not ignored, not empty. */
function said(message: MessageV2.WithParts | undefined) {
  return (
    message?.parts
      .filter((part): part is MessageV2.TextPart => part.type === "text")
      .findLast((part) => !part.synthetic && !part.ignored && part.text.length > 0)?.text ?? ""
  )
}

/** The session's pending wakeups and cron tasks, when the wakeup service is available. */
const crons = Effect.fn("KiloHookLoop.crons")(function* (sessionID: SessionID) {
  const service = yield* Effect.serviceOption(Wakeup.Service)
  if (Option.isNone(service)) return undefined
  const once = yield* service.value.list({ sessionID })
  const recurring = yield* service.value.cronList({ sessionID })
  return [
    ...once.map((item) => ({
      id: item.id,
      schedule: new Date(item.dueAt).toISOString(),
      recurring: false,
      prompt: item.prompt,
    })),
    ...recurring.map((item) => ({
      id: item.id,
      schedule: item.schedule,
      recurring: item.recurring,
      prompt: item.prompt,
    })),
  ]
})

/**
 * Stop / SubagentStop at the natural end of a turn. Returns true when a hook made the turn
 * continue (a continuation user message was persisted), within the loop caps.
 */
export const stop = Effect.fn("KiloHookLoop.stop")(function* (input: {
  sessionID: SessionID
  session: Session.Info
  step: number
  user: MessageV2.User
  assistant?: MessageV2.WithParts
  msgs: MessageV2.WithParts[]
  sessions: Session.Interface
  config: Config.Interface
  database: Database.Interface
  events: EventV2.Interface
}) {
  // A turn that ends here was not stopped by a hook: drop any stale reason for the goal runner.
  reasons.delete(input.sessionID)
  // Re-entry with nothing to do (e.g. summarize after a blocked compaction), a /compact summary,
  // or a queued prompt taking over: not the end of an agent turn.
  if (input.step === 0) return false
  if (input.assistant?.info.role === "assistant" && input.assistant.info.summary === true) return false
  if (KiloSessionPromptQueue.hasFollowup(input.sessionID)) return false
  const event = input.session.parentID ? "SubagentStop" : "Stop"
  const subjects = event === "SubagentStop" ? [input.user.agent, KiloHookPayload.alias(input.user.agent)] : []
  const hooks = yield* resolve(input.sessionID, event, input)
  if (!KiloHooks.select(hooks, event, subjects).length) return false

  const users = input.msgs.filter((msg) => msg.info.role === "user")
  const at = users.findIndex((msg) => msg.info.id === input.user.id)
  const tag = users
    .at(at)
    ?.parts.map(continuation)
    .find((item) => item !== undefined)
  // Claude Code resets the consecutive count whenever the model used a tool since the last continuation.
  const tooled = input.msgs.some(
    (msg) =>
      msg.info.role === "assistant" &&
      msg.info.parentID === input.user.id &&
      msg.parts.some((part) => part.type === "tool"),
  )
  const streak = tag && !tooled ? tag.streak : 0
  // The per-turn ceiling never resets: count every continuation since the turn's root user message.
  const start = users.slice(0, at + 1).findLastIndex((msg) => !msg.parts.some((part) => continuation(part)))
  const count =
    at < 0 ? 0 : users.slice(start + 1, at + 1).filter((msg) => msg.parts.some((part) => continuation(part))).length
  const attended = KiloHookPayload.attendance({
    sessionID: input.sessionID,
    parent: input.session.parentID,
    messages: input.msgs,
    user: input.user.id,
  })

  const list = yield* crons(input.sessionID).pipe(
    Effect.catchCause((cause) => {
      log.warn("could not list session crons for a Stop hook", { cause: String(cause) })
      return Effect.succeed(undefined)
    }),
  )
  const payload = {
    ...KiloHookPayload.base(event, {
      sessionID: input.sessionID,
      root: yield* root(input.session, input.sessions),
      parent: input.session.parentID,
      cwd: input.session.directory,
      agent: input.user.agent,
      prompt: input.user.id,
      mode: KiloHookPayload.mode(input.session.permission, input.user.agent),
    }),
    stop_hook_active: tag !== undefined,
    last_assistant_message: said(input.assistant),
    ...(list ? { session_crons: list } : {}),
    ...(event === "SubagentStop" ? { kilo_agent_type: input.user.agent } : {}),
  }
  const verdict = yield* KiloHooks.fire({
    event,
    hooks,
    subjects,
    payloads: [payload],
    cwd: input.session.directory,
    sessionID: input.sessionID,
    events: input.events,
  })
  if (verdict.stop !== undefined) {
    const reason = verdict.stop.trim()
    if (reason) yield* KiloHooks.notice(input.events, input.sessionID, `${event} hook stopped the turn: ${reason}`)
    return false
  }
  if (!verdict.block && !verdict.context.length) return false
  const limit = cap()
  if (streak >= limit || count >= (attended ? 3 * limit : 2)) {
    yield* KiloHooks.notice(
      input.events,
      input.sessionID,
      `${event} hook kept the turn going ${count} times; Kilo ended the turn.`,
    )
    return false
  }

  const text = [
    ...(verdict.block ? [`${event} hook feedback:\n${verdict.block}`] : []),
    ...(verdict.context.length ? [KiloHooks.wrap(event, verdict.context)] : []),
  ].join("\n\n")
  const msg: MessageV2.User = {
    id: MessageID.ascending(),
    sessionID: input.sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: input.user.agent,
    model: input.user.model,
    ...(input.user.format ? { format: input.user.format } : {}),
    ...(input.user.editorContext ? { editorContext: input.user.editorContext } : {}),
    ...(input.user.system !== undefined ? { system: input.user.system } : {}),
    ...(input.user.tools ? { tools: input.user.tools } : {}),
  }
  yield* input.sessions.updateMessage(msg)
  yield* input.sessions.updatePart({
    id: PartID.ascending(),
    messageID: msg.id,
    sessionID: input.sessionID,
    type: "text",
    text,
    synthetic: true,
    metadata: { hook: { event, streak: streak + 1 } },
  } satisfies MessageV2.TextPart)
  KiloHooks.keep(turns, msg.id, turn(input.user.id), LIMIT)
  // Queued prompts hide later user messages from the running turn; this one belongs to it.
  KiloSessionPromptQueue.retarget(input.sessionID, msg.id)
  return true
})

/** The tool calls of a model step that ran tools, without provider-executed or orphaned ones. */
function ran(parts: readonly MessageV2.Part[]) {
  return parts.filter(
    (part): part is MessageV2.ToolPart =>
      part.type === "tool" &&
      !part.metadata?.providerExecuted &&
      !(part.state.status === "error" && part.state.metadata?.interrupted === true),
  )
}

function feedback(event: string, notes: readonly string[]) {
  return `<hook_feedback event="${event}">\n${KiloHooks.clip(notes.join("\n\n"))}\n</hook_feedback>`
}

/**
 * PostToolBatch after a model step that ran tools, and the halt a tool hook's `continue: false`
 * requested. Returns true when the turn must end.
 */
export const batch = Effect.fn("KiloHookLoop.batch")(function* (input: {
  sessionID: SessionID
  message: MessageV2.Assistant
  result: SessionProcessor.Result
  sessions: Session.Interface
  config: Config.Interface
  database: Database.Interface
  events: EventV2.Interface
}) {
  reasons.delete(input.sessionID)
  const held = halts.get(input.sessionID)
  halts.delete(input.sessionID)
  // A halt from an earlier turn (one that ended before reaching this point) is stale.
  if (held && (!held.prompt || held.prompt === input.message.parentID)) {
    const text = `A ${held.event} hook stopped the turn: ${held.reason.trim() || "No reason given."}`
    yield* KiloHooks.notice(input.events, input.sessionID, text)
    KiloHooks.keep(reasons, input.sessionID, text, LIMIT)
    return true
  }
  // A compaction step does not reach the next model call, unless a PreCompact hook vetoed the
  // compaction: then the turn goes on uncompacted, like any other step that ran tools.
  if (input.result === "compact" && vetoed(input.message.parentID) === undefined) return false
  const hooks = yield* resolve(input.sessionID, "PostToolBatch", input)
  if (!KiloHooks.select(hooks, "PostToolBatch", []).length) return false
  const tools = ran(
    yield* MessageV2.parts(input.message.id).pipe(Effect.provideService(Database.Service, input.database)),
  )
  if (!tools.length) return false
  const session = yield* input.sessions.get(input.sessionID).pipe(Effect.catch(() => Effect.succeed(undefined)))
  if (!session) return false
  const payload = {
    ...KiloHookPayload.base("PostToolBatch", {
      sessionID: input.sessionID,
      root: yield* root(session, input.sessions),
      parent: session.parentID,
      cwd: session.directory,
      agent: input.message.agent,
      prompt: input.message.parentID,
      mode: KiloHookPayload.mode(session.permission, input.message.agent),
    }),
    tool_calls: tools.map((part) => {
      const info = KiloHooks.input("PostToolBatch", {
        tool: part.tool,
        args: part.state.input,
        sessionID: input.sessionID,
        directory: session.directory,
      })
      return {
        tool_name: info.tool_name,
        tool_input: info.tool_input,
        tool_use_id: part.callID,
        tool_response:
          part.state.status === "completed" ? part.state.output : part.state.status === "error" ? part.state.error : "",
      }
    }),
  }
  const verdict = yield* KiloHooks.fire({
    event: "PostToolBatch",
    hooks,
    payloads: [payload],
    cwd: session.directory,
    sessionID: input.sessionID,
    events: input.events,
  })
  const last = tools.at(-1)
  if (verdict.context.length && last) {
    const note = feedback("PostToolBatch", verdict.context)
    const state =
      last.state.status === "completed"
        ? { ...last.state, output: `${last.state.output}\n\n${note}` }
        : last.state.status === "error"
          ? { ...last.state, error: `${last.state.error}\n\n${note}` }
          : undefined
    if (state) yield* input.sessions.updatePart({ ...last, state })
  }
  const reason = verdict.block ?? (verdict.stop === undefined ? undefined : verdict.stop.trim() || "No reason given.")
  if (reason === undefined) return false
  const text = `PostToolBatch hook stopped the turn: ${reason}`
  yield* KiloHooks.notice(input.events, input.sessionID, text)
  KiloHooks.keep(reasons, input.sessionID, text, LIMIT)
  return true
})

/** SubagentStart when the task tool spawns or resumes a subagent: parts for the child's first prompt. */
export const subagent = Effect.fn("KiloHookLoop.subagent")(function* (input: {
  parent: SessionID
  child: Session.Info
  agent: string
  resumed: boolean
  signal?: AbortSignal
  /** The parent's resolved hooks (`ctx.extra.hooks`). */
  hooks?: unknown
  config: Config.Interface
  database: Database.Interface
}) {
  const none: SessionPrompt.PromptInput["parts"] = []
  // Hooks travel in the tool context: resolving them here, inside the sandbox tool gate, could
  // deadlock with a concurrent sandbox toggle.
  const hooks = KiloHooks.from(input.hooks)
  if (!hooks) return none
  const subjects = [input.agent, KiloHookPayload.alias(input.agent)]
  if (!KiloHooks.select(hooks, "SubagentStart", subjects).length) return none
  const verdict = yield* KiloHooks.fire({
    event: "SubagentStart",
    hooks,
    subjects,
    payloads: [
      {
        ...KiloHookPayload.base("SubagentStart", {
          sessionID: input.child.id,
          root: (yield* lineage(input.parent, input.database)).root,
          parent: input.parent,
          cwd: input.child.directory,
          agent: input.agent,
        }),
        kilo_agent_type: input.agent,
        kilo_resumed: input.resumed,
      },
    ],
    cwd: input.child.directory,
    // Exit-2 stderr and failures are shown on the parent session, where the user is looking.
    sessionID: input.parent,
    signal: input.signal,
  })
  if (!verdict.context.length) return none
  const parts: SessionPrompt.PromptInput["parts"] = [
    {
      type: "text",
      text: KiloHooks.wrap("SubagentStart", verdict.context),
      synthetic: true,
      metadata: { hook: { event: "SubagentStart" } },
    },
  ]
  return parts
})

// Halts a tool hook requested with `continue: false`, read by the PostToolBatch site.
const halts = new Map<string, { reason: string; event: string; prompt?: string }>()

/**
 * Records that a tool hook stopped the turn (`continue: false`); the PostToolBatch site ends it.
 * `prompt` is the turn's user message id, so a halt left by a turn that ended early is dropped.
 */
export function halt(sessionID: string, reason: string, source?: { event?: string; prompt?: string }): void {
  KiloHooks.keep(halts, sessionID, { reason, event: source?.event ?? "tool", prompt: source?.prompt }, LIMIT)
}

// Why a hook stopped a session's last turn, for the goal runner.
const reasons = new Map<string, string>()

/** Reads and clears the reason a hook stopped the session's last turn, for the goal runner. */
export function stopped(sessionID: string): string | undefined {
  const value = reasons.get(sessionID)
  reasons.delete(sessionID)
  return value
}

export * as KiloHookLoop from "./loop"
