import path from "path"
import { Effect } from "effect"
import { Flag } from "@opencode-ai/core/flag/flag"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import type { PermissionV1 } from "@opencode-ai/core/v1/permission"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { ConfigManaged } from "@/config/managed"
import { KiloSession } from "@/kilocode/session"
import type { Session } from "@/session/session"
import type { SessionID } from "@/session/schema"
import { isRecord } from "@/util/record"
import type { Event } from "./events"

/** Common hook input fields, using Claude Code's names, plus Kilo extras prefixed `kilo_`. */
export function base(
  event: Event,
  ctx: {
    sessionID?: string
    root?: string
    parent?: string
    cwd: string
    agent?: string
    prompt?: string
    mode?: string
  },
): Record<string, unknown> {
  const platform = ctx.sessionID ? KiloSession.resolvePlatform(ctx.sessionID) : undefined
  return {
    ...(ctx.sessionID ? { session_id: ctx.root ?? ctx.sessionID } : {}),
    hook_event_name: event,
    cwd: ctx.cwd,
    ...(ctx.prompt ? { prompt_id: ctx.prompt } : {}),
    ...(ctx.mode ? { permission_mode: ctx.mode } : {}),
    ...(ctx.sessionID && ctx.parent
      ? { agent_id: ctx.sessionID, ...(ctx.agent ? { agent_type: alias(ctx.agent) } : {}) }
      : {}),
    ...(ctx.sessionID ? { kilo_session_id: ctx.sessionID } : {}),
    ...(ctx.agent ? { kilo_agent: ctx.agent } : {}),
    kilo_platform: platform ?? process.env["KILO_PLATFORM"] ?? Flag.KILO_CLIENT,
  }
}

// Kilo agent names -> the Claude Code agent types matchers and scripts use.
const AGENTS: Record<string, string> = {
  general: "general-purpose",
  explore: "Explore",
  plan: "Plan",
}

/** The Claude Code name of a Kilo agent (`general` -> `general-purpose`), or the Kilo name. */
export function alias(agent: string) {
  return AGENTS[agent] ?? agent
}

// Sessions' roots found by walking `parentID` (bounded: a server can create many subagent sessions).
const roots = new Map<string, string>()
const ROOTS = 4096
const DEPTH = 16

/** Evicts the oldest entry of a map kept in insertion order once it holds more than `limit`. */
function trim(map: Map<string, unknown>, limit: number) {
  if (map.size <= limit) return
  const oldest = map.keys().next()
  if (!oldest.done) map.delete(oldest.value)
}

/**
 * The root session of a session: the id hooks send as `session_id`, as Claude Code sends its main
 * session id for subagent hooks. Uses Kilo's in-memory ancestry, else walks `parentID` through the
 * database (which survives restarts) and registers the result so later lookups stay in memory.
 */
export const root = Effect.fn("KiloHookPayload.root")(function* (
  sessionID: SessionID,
  sessions: Pick<Session.Interface, "get">,
) {
  const known = KiloSession.resolveRoot(sessionID)
  if (known !== sessionID) return known as SessionID
  const cached = roots.get(sessionID)
  if (cached) return cached as SessionID
  const chain: Session.Info[] = []
  const first = yield* sessions.get(sessionID).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
  if (!first) return sessionID
  chain.push(first)
  while (chain.length < DEPTH) {
    const parent = chain.at(-1)?.parentID
    if (!parent) break
    const next = yield* sessions.get(parent).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
    if (!next) break
    chain.push(next)
  }
  const top = chain.at(-1)?.id ?? sessionID
  if (top === sessionID) return sessionID
  roots.set(sessionID, top)
  trim(roots, ROOTS)
  for (const item of chain.toReversed()) {
    if (item.parentID) KiloSession.register({ id: item.id, parentID: item.parentID })
  }
  return top
})

/**
 * Claude Code's `permission_mode`: "bypassPermissions" when the session holds the broad allow rule
 * auto-approve (YOLO) mode installs, "plan" for the plan agent, else "default".
 */
export function mode(ruleset: readonly PermissionV1.Rule[] | undefined, agent?: string) {
  if (ruleset?.some((rule) => rule.permission === "*" && rule.pattern === "*" && rule.action === "allow"))
    return "bypassPermissions"
  if (agent === "plan") return "plan"
  return "default"
}

/**
 * Claude Code's `memory_type` for an instruction file: "Managed" for the managed config directory,
 * "User" for Claude Code and Kilo config directories, else "Project" (repositories usually live
 * under the home directory, so the home directory alone does not make a file a user file).
 */
export function memory(file: string) {
  const full = path.resolve(file)
  if (FSUtil.contains(ConfigManaged.managedConfigDir(), full)) return "Managed"
  const home = Global.Path.home
  const user = [
    path.join(home, ".claude"),
    Global.Path.config,
    path.join(home, ".kilo"),
    path.join(home, ".kilocode"),
    ...(Flag.KILO_CONFIG_DIR ? [Flag.KILO_CONFIG_DIR] : []),
  ]
  return user.some((dir) => FSUtil.contains(dir, full)) ? "User" : "Project"
}

const CONTINUATIONS = new Set(["Stop", "SubagentStop"])

function hook(part: SessionV1.Part) {
  const metadata = "metadata" in part && isRecord(part.metadata) ? part.metadata : undefined
  return isRecord(metadata?.hook) && typeof metadata.hook.event === "string" ? metadata.hook.event : undefined
}

/**
 * Whether someone can answer a prompt in the turn that `userID` belongs to: walks back past Stop
 * hook continuations to the turn's root user message, which is attended when it has a part that is
 * not synthetic text and no background part. Goal ticks, wakeups, cron fires, background results
 * and plan follow-ups are unattended. Unknown turns count as attended.
 */
function attended(messages: readonly SessionV1.WithParts[], userID?: string): boolean {
  if (!userID) return true
  const users = messages.filter((msg) => msg.info.role === "user")
  const at = users.findIndex((msg) => msg.info.id === userID)
  if (at < 0) return true
  const turn = users.slice(0, at + 1).findLast((msg) => !msg.parts.some((part) => CONTINUATIONS.has(hook(part) ?? "")))
  if (!turn) return true
  if (turn.parts.some((part) => "metadata" in part && isRecord(part.metadata) && part.metadata.background === true))
    return false
  return turn.parts.some((part) => part.type !== "text" || !part.synthetic || human(part))
}

/** Whether a synthetic text part is a human prompt that a compaction replay copied (see `replayed`). */
function human(part: SessionV1.Part) {
  return "metadata" in part && isRecord(part.metadata) && part.metadata.kilo_human === true
}

/**
 * The metadata of a text part that a compaction replay copies from `part`: a part a human wrote (or
 * a replay of one) is marked, since the replay makes every text part synthetic and the turn would
 * otherwise count as unattended.
 */
export function replayed(part: SessionV1.Part) {
  const metadata = "metadata" in part && isRecord(part.metadata) ? part.metadata : undefined
  if (part.type === "text" && part.synthetic && !human(part)) return metadata
  return { ...metadata, kilo_human: true }
}

/**
 * The metadata of the one synthetic summary part that stands in for an oversized replayed prompt: it
 * keeps the mark when a human wrote the prompt, since the summary carries no metadata of its own. A
 * Stop hook continuation is not marked, as it never roots a turn.
 */
export function summary(message: SessionV1.WithParts) {
  if (message.parts.some((part) => CONTINUATIONS.has(hook(part) ?? ""))) return undefined
  return attended([message], message.info.id) ? { kilo_human: true } : undefined
}

/**
 * The metadata of the auto-continue message of a compaction: it carries the attendance of the turn
 * being compacted, since the message is synthetic text and would otherwise end the human's turn.
 * `userID` is the compaction's own user message, which is skipped: it is not a prompt.
 */
export function continued(messages: readonly SessionV1.WithParts[], userID: string) {
  const at = messages.findIndex((msg) => msg.info.id === userID)
  const before = at < 0 ? messages : messages.slice(0, at)
  const turn = before.findLast(
    (msg) => msg.info.role === "user" && !msg.parts.some((part) => part.type === "compaction"),
  )
  return attended(before, turn?.info.id) ? { kilo_human: true } : {}
}

// The latest step's attendance per session, so subagents inherit their parent turn's (bounded).
const turns = new Map<string, boolean>()
const TURNS = 4096

/**
 * Whether someone can answer a prompt in a session's current step: `attended()` for its own turn,
 * and for a subagent also its parent's latest step, since the task tool builds a child's first prompt
 * from the parent model's text (which looks human). Records the result for the session's own
 * subagents. A parent with no recorded step counts as attended.
 */
export function attendance(input: {
  sessionID: string
  parent?: string
  messages: readonly SessionV1.WithParts[]
  user?: string
}) {
  const value = attended(input.messages, input.user) && (input.parent ? (turns.get(input.parent) ?? true) : true)
  turns.delete(input.sessionID)
  turns.set(input.sessionID, value)
  trim(turns, TURNS)
  return value
}

/** Model spellings for matchers and stdin: Claude Code uses canonical names and sends bare ids. */
export function model(ref: { providerID: string; modelID: string }) {
  const bare = ref.modelID.split("/").at(-1) ?? ref.modelID
  const canonical = bare
    .toLowerCase()
    .replace("[1m]", "")
    .replace(/[-@]\d{8}$/, "")
    .replaceAll(".", "-")
  return { bare, canonical, subjects: [...new Set([canonical, bare, ref.modelID, `${ref.providerID}/${ref.modelID}`])] }
}

/** Claude Code's StopFailure `error` value for a Kilo assistant error. */
export function failure(error: { name: string; data?: unknown } | undefined) {
  if (!error) return "unknown"
  const data = isRecord(error.data) ? error.data : {}
  const status = typeof data.statusCode === "number" ? data.statusCode : undefined
  if (error.name === "ProviderAuthError") return "authentication_failed"
  if (error.name === "ContextOverflowError") return "invalid_request"
  if (error.name === "MessageOutputLengthError") return "max_output_tokens"
  if (error.name !== "APIError" || status === undefined) return "unknown"
  if (status === 429) return "rate_limit"
  if (status === 529) return "overloaded"
  if (status === 401 || status === 403) return "authentication_failed"
  if (status === 402) return "billing_error"
  if (status === 404) return "model_not_found"
  if (status === 400 || status === 413 || status === 422) return "invalid_request"
  if (status >= 500) return "server_error"
  return "unknown"
}

export * as KiloHookPayload from "./payload"
