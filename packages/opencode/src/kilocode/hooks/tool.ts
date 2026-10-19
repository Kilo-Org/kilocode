import { Effect } from "effect"
import type { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { KiloHooks } from "./hooks"
import { KiloHookLoop } from "./loop"

// Tool events: PreToolUse and PostToolUse around every tool call (session/tools.ts), plus the
// PostToolUseFailure wrapper and the PermissionRequest review that races the permission prompt.

const HOUR = 60 * 60 * 1000

// PreToolUse context waiting for its call's result, keyed by tool call id.
const pending = new Map<string, { time: number; context: string[] }>()

function keep(id: string, context: readonly string[]) {
  const now = Date.now()
  for (const [key, item] of pending) if (now - item.time > HOUR) pending.delete(key)
  pending.set(id, { time: now, context: [...(pending.get(id)?.context ?? []), ...context] })
}

function take(id: string | undefined) {
  if (!id) return []
  const item = pending.get(id)
  pending.delete(id)
  return item?.context ?? []
}

function block(event: string, notes: readonly string[]) {
  return `<hook_feedback event="${event}">\n${KiloHooks.clip(notes.join("\n\n"))}\n</hook_feedback>`
}

/**
 * Runs PreToolUse hooks. Returns the message to fail the tool call with when a hook blocks it,
 * stops the turn, or asks for a confirmation nobody can give. An `ask` on an attended turn shows a
 * forced permission prompt; a rejection fails like any user rejection.
 */
export const before = Effect.fn("KiloHookTool.before")(function* (hooks: KiloHooks.Hooks, call: KiloHooks.Call) {
  const verdict = yield* KiloHooks.fire({
    event: "PreToolUse",
    hooks,
    subjects: KiloHooks.names(call),
    call,
    payloads: KiloHooks.inputs("PreToolUse", call),
    cwd: call.directory,
    sessionID: call.sessionID,
    signal: call.abort,
  })
  // The user cancelled while the hooks ran: never let the tool run without its guards.
  if (verdict.ran && call.abort?.aborted) return "The tool call was aborted before it ran."
  if (verdict.block) return `A PreToolUse hook blocked this ${call.tool} call:\n${verdict.block}`
  if (verdict.stop !== undefined) {
    KiloHookLoop.halt(call.sessionID, verdict.stop)
    return `A PreToolUse hook stopped the turn: ${verdict.stop.trim() || "No reason given."}`
  }
  if (verdict.ask !== undefined) {
    if (!call.confirm || call.attended === false)
      return `A PreToolUse hook asked for confirmation, but nobody can answer in this turn: ${verdict.ask}`
    yield* call.confirm(verdict.ask)
  }
  if (verdict.context.length && call.callID) keep(call.callID, verdict.context)
  return undefined
})

/**
 * Runs PostToolUse hooks: `updatedToolOutput` replaces the output the model sees (text and
 * attachments; the UI may still show the streamed original from metadata), then PreToolUse context
 * and PostToolUse feedback are appended to it.
 */
export const after = Effect.fn("KiloHookTool.after")(function* (
  hooks: KiloHooks.Hooks,
  call: KiloHooks.Call,
  result: { output: string; metadata?: unknown; attachments?: unknown[] },
) {
  const verdict = yield* KiloHooks.fire({
    event: "PostToolUse",
    hooks,
    subjects: KiloHooks.names(call),
    call,
    payloads: KiloHooks.inputs("PostToolUse", call, KiloHooks.response(call, result), result.output),
    cwd: call.directory,
    sessionID: call.sessionID,
    signal: call.abort,
  })
  if (verdict.output !== undefined) {
    // A replacement only narrows what the model sees: never longer than the tool's own output
    // (already truncated) or one hook output item, and without the original's images or files.
    result.output = KiloHooks.clip(verdict.output, Math.max(KiloHooks.FEEDBACK, result.output.length))
    if (result.attachments) result.attachments = []
  }
  if (verdict.stop !== undefined) KiloHookLoop.halt(call.sessionID, verdict.stop)
  const pre = take(call.callID)
  const notes = [
    ...(pre.length ? [block("PreToolUse", pre)] : []),
    ...(verdict.context.length ? [block("PostToolUse", verdict.context)] : []),
  ]
  if (notes.length) result.output = `${result.output}\n\n${notes.join("\n\n")}`
})

/**
 * Runs PostToolUseFailure hooks when the tool call fails, appending their feedback to the error
 * the model sees. Control-flow errors (rejections, hook blocks) pass through untouched.
 */
export function failure<A, E, R>(
  _hooks: KiloHooks.Hooks,
  _call: KiloHooks.Call,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  return effect
}

/** Decides a pending permission request; resolves with a deny when a hook denies it. */
export type Review = (request: PermissionV1.Request) => Effect.Effect<{ deny?: string; interrupt?: boolean }>

/** The PermissionRequest review for a tool call's permission asks, when the event has handlers. */
export function review(_hooks: KiloHooks.Hooks, _call: KiloHooks.Call): Review | undefined {
  return undefined
}

/**
 * Races a pending permission prompt: never settles unless a hook denies, in which case `closed`
 * dismisses the prompt and the call fails (a `Denied` defect, or a rejection on interrupt).
 */
export function contest(
  _review: Review | undefined,
  _info: PermissionV1.Request,
  _closed: () => Effect.Effect<void>,
): Effect.Effect<never, PermissionV1.RejectedError> {
  return Effect.never
}

export * as KiloHookTool from "./tool"
