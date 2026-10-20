import { Cause, Effect } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import type { Config } from "@/config/config"
import type { RuntimeFlags } from "@/effect/runtime-flags"
import { MessageID, SessionID } from "@/session/schema"
import { BoardEnabled } from "@/kilocode/board/enabled"
import { BoardStore } from "@/kilocode/board/store"
import { KiloSession } from "@/kilocode/session"
import { KiloSessionPromptQueue } from "@/kilocode/session/prompt-queue"
import { KiloSessionSteeringInbox } from "@/kilocode/session/steering-inbox"
import { SteeringNotice } from "@/kilocode/session/steering-notice"
import type { Tool } from "@/tool/tool"

/**
 * Metadata kind a client puts on the text part a human typed into a subagent
 * view. Only marked parts count as steering: the task tool's own prompts to a
 * child session are also non-synthetic text, so `parentID` alone is not proof
 * that a human steered the child.
 */
export const KIND = "subagent_steer"

const PREFIX = "The user steered this subagent directly:\n\n"
// Budget for the JSON-escaped body. The formatted board message adds id,
// timestamp, route, and type (~200 bytes) and must stay under 4 KiB.
const BUDGET = 3584

type Part = {
  type: string
  text?: string
  synthetic?: boolean
  ignored?: boolean
  metadata?: Record<string, unknown>
}

export function text(parts: ReadonlyArray<Part>) {
  return parts
    .flatMap((part) =>
      part.type === "text" && !part.synthetic && part.metadata?.kind === KIND && part.text ? [part.text] : [],
    )
    .join("\n")
    .trim()
}

/** Plain user wording of a prompt, regardless of client steering metadata. */
export function plain(parts: ReadonlyArray<Part>) {
  return parts
    .flatMap((part) =>
      part.type === "text" && !part.synthetic && !part.ignored && part.metadata?.background !== true
        ? [part.text ?? ""]
        : [],
    )
    .join("\n")
    .trim()
}

/** Excerpt the body so its JSON-escaped form fits the board message budget. */
export function body(value: string) {
  const fit = (bytes: number): string => {
    const out = BoardStore.excerpt(PREFIX + value, bytes)
    const size = Buffer.byteLength(JSON.stringify(out))
    if (size <= BUDGET || bytes <= 1) return out
    return fit(Math.max(1, Math.min(bytes - 1, Math.floor((bytes * BUDGET) / size))))
  }
  return fit(BUDGET)
}

/** Steering fan-out is opt-in for the first version. */
export function enabled(input: {
  config: Pick<Config.Info, "experimental">
  flags: Pick<RuntimeFlags.Info, "experimentalSubagentSteering">
}) {
  return input.config.experimental?.subagent_steering === true || input.flags.experimentalSubagentSteering
}

/**
 * A prompt carries real user direction only when it has a non-synthetic text
 * part. Compaction markers, background task results, and internal follow-ups are
 * admission scaffolding and must never fan out.
 */
export function user(parts: ReadonlyArray<Part>) {
  return parts.some(
    (part) =>
      part.type === "text" &&
      !part.synthetic &&
      !part.ignored &&
      part.metadata?.background !== true &&
      part.metadata?.background !== "true" &&
      part.text?.trim(),
  )
}

function active(id: SessionID) {
  return KiloSessionPromptQueue.active(id) !== undefined
}

/**
 * Deliver a mid-run user update to the active task subagents of the session that
 * received it. Returns the revision, or undefined when nothing was posted.
 *
 * Only active descendants are targeted: a finished child has no work to adjust,
 * and its parent sees a stale annotation on the returned result instead. Each
 * child filters relevance itself, so the parent agent does not split the message.
 */
export function fanout(input: { origin: SessionID; messageID: MessageID; parts: ReadonlyArray<Part> }) {
  if (!user(input.parts)) return undefined
  const value = plain(input.parts)
  if (!value) return undefined
  const targets = KiloSession.descendants(input.origin)
    .map((id) => SessionID.make(id))
    .filter(active)
  return KiloSessionSteeringInbox.post({
    origin: input.origin,
    messageID: input.messageID,
    text: value,
    targets,
  })
}

/** Mark a revision as consumed by the child on its next tool boundary. */
export function ack(target: SessionID, revision: number) {
  KiloSessionSteeringInbox.ack(target, revision)
}

/**
 * Returned with a subagent result that predates an update. The work is kept: it
 * usually still holds findings, but the parent must reconcile it with the new
 * direction instead of treating it as final.
 */
export const staleNote =
  "<subagent-steering-stale>The user updated their direction after this result was produced. Reconcile it with the new direction before relying on it; parts of it may be obsolete.</subagent-steering-stale>"

/** True when the child finished before consuming its newest steering revision. */
export function stale(target: SessionID) {
  return KiloSessionSteeringInbox.stale(target)
}

/** @internal - test-only helper */
export function _reset() {
  KiloSessionSteeringInbox._reset()
}

/**
 * Post a shared-board message from a steered subagent to its parent so the
 * parent learns that a human redirected its child. Failures are logged and
 * never fail prompt admission.
 */
export const notify = Effect.fn("KiloSessionSteering.notify")(function* (input: {
  session: { id: SessionID; parentID?: SessionID }
  parts: ReadonlyArray<Part>
  messageID: string
  config: Config.Interface
  flags: RuntimeFlags.Info
  database: Database.Interface
}) {
  const parent = input.session.parentID
  if (!parent) return
  const steer = text(input.parts)
  if (!steer) return
  if (!BoardEnabled.on(yield* input.config.get(), input.flags)) return
  yield* BoardStore.post({
    sessionID: input.session.id,
    messageID: input.messageID,
    to: parent,
    type: "INFO",
    body: body(steer),
  }).pipe(
    Effect.provideService(Database.Service, input.database),
    Effect.catch((err) =>
      Effect.logWarning("subagent steering notification failed", { "session.id": input.session.id, err }),
    ),
  )
})

/**
 * Build the tool-result notifier for a session. Composes shared-board activity
 * notices with steering notices so the upstream tool loop keeps a single seam.
 *
 * The steering notice attaches at most one pending revision per tool result and
 * only acks after it was attached, so an aborted call never consumes direction
 * the child did not see.
 */
export const notifier = Effect.fn("KiloSessionSteering.notifier")(function* (input: {
  sessionID: SessionID
  enabled: boolean
  board?: <T extends Tool.ExecuteResult>(tool: string, output: T, signal?: AbortSignal) => Effect.Effect<T>
}) {
  return <T extends Tool.ExecuteResult>(tool: string, output: T, signal?: AbortSignal) =>
    Effect.gen(function* () {
      const clean = SteeringNotice.clean(output)
      const next = input.board ? yield* input.board(tool, clean, signal) : clean
      if (signal?.aborted) return next
      const entry = input.enabled ? KiloSessionSteeringInbox.pending(input.sessionID) : undefined
      if (!entry) return next
      ack(input.sessionID, entry.revision)
      return {
        ...next,
        metadata: { ...next.metadata, [SteeringNotice.key]: { revision: entry.revision, text: entry.text } },
      }
    }).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause)
        return Effect.gen(function* () {
          yield* Effect.logWarning("steering notice unavailable", { "session.id": input.sessionID })
          return output
        })
      }),
      Effect.orDie,
    )
})

/**
 * Enqueue unconsumed steering as a real user turn so a child ending its turn
 * cannot return a result produced under superseded instructions. The revision is
 * acked here so escalation cannot re-trigger itself.
 */
export const escalate = Effect.fn("KiloSessionSteering.escalate")(function* (input: {
  sessionID: SessionID
  deliver: (message: { sessionID: SessionID; text: string }) => Effect.Effect<unknown, unknown>
}) {
  const entry = KiloSessionSteeringInbox.pending(input.sessionID)
  if (!entry) return undefined
  // Ack before creating the turn: a failed write must not make the next turn
  // retry the escalation forever, and the user's newer prompt still carries the
  // direction to the parent.
  ack(input.sessionID, entry.revision)
  // Fork the delivery: the follow-up turn queues behind the current one, so
  // awaiting it here would wait on a turn that is itself waiting on this one.
  yield* input.deliver({ sessionID: input.sessionID, text: escalated(entry) }).pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.void
        : Effect.logWarning("steering escalation delivery failed", { "session.id": input.sessionID, cause }),
    ),
    Effect.forkDetach,
  )
  return entry.revision
})

export function escalated(entry: { text: string }) {
  return [
    "<subagent-steering>",
    "The user updated their direction while you were working. Adjust your work and continue without asking, or stop and report to your parent if your task is now obsolete.",
    "Completed actions are not undone by this update.",
    `User's words: ${entry.text}`,
    "</subagent-steering>",
  ].join("\n")
}

export * as KiloSessionSteering from "./steering"
