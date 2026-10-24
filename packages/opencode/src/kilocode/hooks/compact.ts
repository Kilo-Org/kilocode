import { Effect } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import type { EventV2 } from "@opencode-ai/core/event"
import * as Log from "@opencode-ai/core/util/log"
import { Config } from "@/config/config"
import { InstanceRef } from "@/effect/instance-ref"
import { KiloSession } from "@/kilocode/session"
import { MessageV2 } from "@/session/message-v2"
import type { MessageID, SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import type { Event } from "./events"
import { KiloHooks } from "./hooks"
import { KiloHookLifecycle } from "./lifecycle"
import { KiloHookLoop } from "./loop"
import { KiloHookPayload } from "./payload"
import { KiloHookSession } from "./session"

// Compaction events: PreCompact (asked by each caller before creating a compaction, with
// auto-compaction vetoes remembered per turn) and PostCompact.

const log = Log.create({ service: "hooks" })

const LIMIT = 256

// The last block reason per session, for the overflow error that ends the turn.
const reasons = new Map<string, string>()
// Sessions whose next compaction the model asked for with the `context` tool, for PostCompact.
const tools = new Map<string, true>()
// Sessions whose threshold compaction `skip` just allowed, so the `allow` that follows it at the
// overflow recovery site does not run the hooks a second time.
const granted = new Map<string, true>()

/** The session's hooks for a compaction event: the tool context's when given, else resolved; fails open. */
function hooks(
  sessionID: SessionID,
  event: Event,
  input: { hooks?: unknown; config?: Config.Interface; database?: Database.Interface },
) {
  const given = KiloHooks.from(input.hooks)
  if (given) return Effect.succeed(given)
  if (!input.config || !input.database) return Effect.succeed({} as KiloHooks.Hooks)
  return KiloHooks.resolve(sessionID, event).pipe(
    Effect.provideService(Config.Service, input.config),
    Effect.provideService(Database.Service, input.database),
    Effect.catchCause((cause) => {
      log.warn("could not resolve hooks", { event, sessionID, cause: String(cause) })
      return Effect.succeed({} as KiloHooks.Hooks)
    }),
  )
}

/** Common input fields for a compaction event, with the session's root, agent and directory. */
const base = Effect.fn("KiloHookCompact.base")(function* (
  event: Event,
  sessionID: SessionID,
  database?: Database.Interface,
) {
  const line = yield* KiloHookLoop.lineage(sessionID, database)
  const cwd = line.directory ?? (yield* InstanceRef)?.directory ?? process.cwd()
  return {
    cwd,
    payload: KiloHookPayload.base(event, { sessionID, root: line.root, parent: line.parent, cwd, agent: line.agent }),
  }
})

/** PreCompact for one request: the block reason, or undefined when the compaction may proceed. */
const ask = Effect.fn("KiloHookCompact.ask")(function* (input: {
  sessionID: SessionID
  trigger: "manual" | "auto"
  kilo?: "tool"
  hooks?: unknown
  config?: Config.Interface
  database?: Database.Interface
  events?: EventV2.Interface
}) {
  const list = yield* hooks(input.sessionID, "PreCompact", input)
  const subjects = [input.trigger]
  if (!KiloHooks.select(list, "PreCompact", subjects).length) return undefined
  const info = yield* base("PreCompact", input.sessionID, input.database)
  const verdict = yield* KiloHooks.fire({
    event: "PreCompact",
    hooks: list,
    subjects,
    payloads: [
      {
        ...info.payload,
        trigger: input.trigger,
        ...(input.kilo ? { kilo_trigger: input.kilo } : {}),
        custom_instructions: null,
      },
    ],
    cwd: info.cwd,
    sessionID: input.sessionID,
    events: input.events,
  })
  return verdict.block ?? (verdict.stop === undefined ? undefined : verdict.stop.trim() || "No reason given.")
})

/**
 * PreCompact before a compaction request. Returns false when a hook blocked it (manual requests
 * are told why). An auto-compaction veto holds for the rest of the turn. `hooks` comes from a tool
 * context, so nothing resolves sandbox state inside it.
 */
export const allow = Effect.fn("KiloHookCompact.allow")(function* (input: {
  sessionID: SessionID
  /** User message of the turn, which an auto-compaction veto is remembered for. */
  user?: MessageID
  trigger: "manual" | "auto"
  /** Kilo-specific trigger sent as `kilo_trigger` (the `context` tool). */
  kilo?: "tool"
  overflow?: boolean
  /** A user-initiated request: a block is shown to the user. */
  manual?: boolean
  hooks?: unknown
  config?: Config.Interface
  database?: Database.Interface
  events?: EventV2.Interface
}) {
  // `skip` already asked the hooks for this threshold compaction and they allowed it.
  if (input.overflow && granted.delete(input.sessionID)) return true
  // A user-initiated request is never one the model asked for.
  if (input.manual) tools.delete(input.sessionID)
  // A veto holds for the whole turn: later steps skip compaction without asking again.
  const vetoed = KiloHookLoop.vetoed(input.user)
  if (vetoed !== undefined) {
    KiloHooks.keep(reasons, input.sessionID, vetoed, LIMIT)
    return false
  }
  const reason = yield* ask(input)
  if (reason === undefined) {
    if (input.kilo === "tool") KiloHooks.keep(tools, input.sessionID, true, LIMIT)
    return true
  }
  KiloHooks.keep(reasons, input.sessionID, reason, LIMIT)
  if (input.user && input.trigger === "auto") KiloHookLoop.veto(input.user, reason)
  if (input.manual && input.events)
    yield* KiloHooks.notice(input.events, input.sessionID, `PreCompact hook blocked compaction: ${reason}`)
  log.info("a PreCompact hook blocked compaction", { sessionID: input.sessionID, trigger: input.trigger, reason })
  return false
})

/**
 * At the overflow recovery site: whether a threshold compaction is skipped because a PreCompact hook
 * vetoed it. A step the provider accepted (it finished) only reached the compaction threshold, so
 * the turn goes on uncompacted, as with a preflight veto, until the provider really overflows.
 * After a provider overflow, or Kilo's request-time estimate (no finish), the request cannot go
 * out as it is: `allow` and `overflow` handle those. Allowed requests do not ask the hooks again.
 */
export const skip = Effect.fn("KiloHookCompact.skip")(function* (
  message: MessageV2.Assistant,
  user: MessageID,
  input: { config: Config.Interface; database: Database.Interface; events: EventV2.Interface },
) {
  granted.delete(message.sessionID)
  if (!message.finish || message.error) return false
  if (yield* allow({ sessionID: message.sessionID, user, trigger: "auto", ...input })) {
    KiloHooks.keep(granted, message.sessionID, true, LIMIT)
    return false
  }
  log.info("a PreCompact veto keeps the turn going uncompacted", { sessionID: message.sessionID })
  return true
})

/** Ends a turn whose overflow recovery a PreCompact hook blocked, as a context overflow error. */
export const overflow = Effect.fn("KiloHookCompact.overflow")(function* (input: {
  sessionID: SessionID
  message: MessageV2.Assistant
  closeReasons: Map<string, KiloSession.CloseReason>
  sessions: Session.Interface
  events: EventV2.Interface
}) {
  const reason = reasons.get(input.sessionID) ?? "No reason given."
  // Without an error the loop would retry the overflowing request forever.
  const error = new MessageV2.ContextOverflowError({
    message: `Compaction was blocked by a PreCompact hook: ${reason}`,
  }).toObject()
  input.message.error = error
  input.message.finish ??= "error"
  yield* input.sessions.updateMessage(input.message)
  input.closeReasons.set(input.sessionID, "error")
  yield* input.events.publish(Session.Event.Error, { sessionID: input.sessionID, error })
  return "break" as const
})

/**
 * PostCompact after a compaction succeeded (detached); the next model step runs SessionStart
 * `compact`. A compaction the model asked for with the `context` tool is `auto` with
 * `kilo_trigger: "tool"`, as PreCompact sent it.
 */
export const compacted = Effect.fn("KiloHookCompact.compacted")(function* (input: {
  sessionID: SessionID
  auto: boolean
  summary: string
  config: Config.Interface
  database: Database.Interface
}) {
  KiloHookSession.compacted(input.sessionID)
  const tool = !input.auto && tools.delete(input.sessionID)
  const trigger = input.auto || tool ? "auto" : "manual"
  const list = yield* hooks(input.sessionID, "PostCompact", input)
  if (!KiloHooks.select(list, "PostCompact", [trigger]).length) return
  const info = yield* base("PostCompact", input.sessionID, input.database)
  yield* KiloHookLifecycle.detach(
    KiloHooks.fire({
      event: "PostCompact",
      hooks: list,
      subjects: [trigger],
      payloads: [
        {
          ...info.payload,
          trigger,
          ...(tool ? { kilo_trigger: "tool" } : {}),
          compact_summary: input.summary,
        },
      ],
      cwd: info.cwd,
      sessionID: input.sessionID,
    }),
  )
})

export * as KiloHookCompact from "./compact"
