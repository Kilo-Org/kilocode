import { Effect } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import type { Config } from "@/config/config"
import type { RuntimeFlags } from "@/effect/runtime-flags"
import type { BackgroundJob } from "@/background/job"
import type { Session } from "@/session/session"
import { PartID, type MessageID, type SessionID } from "@/session/schema"
import { BoardEnabled } from "@/kilocode/board/enabled"
import { BoardStore } from "@/kilocode/board/store"
import { KiloTaskPause } from "@/kilocode/tool/task-pause"

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

type Part = { type: string; text?: string; synthetic?: boolean; metadata?: Record<string, unknown> }

export function text(parts: ReadonlyArray<Part>) {
  return parts
    .flatMap((part) =>
      part.type === "text" && !part.synthetic && part.metadata?.kind === KIND && part.text ? [part.text] : [],
    )
    .join("\n")
    .trim()
}

/** Excerpt the body so its JSON-escaped form fits the board message budget. */
export function body(value: string, prefix = PREFIX) {
  const fit = (bytes: number): string => {
    const out = BoardStore.excerpt(prefix + value, bytes)
    const size = Buffer.byteLength(JSON.stringify(out))
    if (size <= BUDGET || bytes <= 1) return out
    return fit(Math.max(1, Math.min(bytes - 1, Math.floor((bytes * BUDGET) / size))))
  }
  return fit(BUDGET)
}

/**
 * Post a shared-board INFO from a subagent to its parent about something a
 * human did to the subagent. Gated by the board setting; failures are logged
 * and never fail the caller.
 */
export const post = Effect.fn("KiloSessionSteering.post")(function* (input: {
  from: SessionID
  to: SessionID
  messageID: string
  body: string
  config: Config.Interface
  flags: RuntimeFlags.Info
  database: Database.Interface
}) {
  if (!BoardEnabled.on(yield* input.config.get(), input.flags)) return
  yield* BoardStore.post({
    sessionID: input.from,
    messageID: input.messageID,
    to: input.to,
    type: "INFO",
    body: input.body,
  }).pipe(
    Effect.provideService(Database.Service, input.database),
    Effect.catch((err) => Effect.logWarning("subagent board notice failed", { "session.id": input.from, err })),
  )
})

/** Hidden reminder for a child steered while its task runs: the steer redirects, it does not replace, the task. */
export function running() {
  return [
    "<system-reminder>",
    "The user steered you directly with the message above while you work on the task your parent agent gave you.",
    "Apply this direction, then continue your original task.",
    "Your final response is returned to your parent agent, so it must still deliver the result of the original task, not just an acknowledgement of this message.",
    "</system-reminder>",
  ].join("\n")
}

/** Hidden reminder for a child whose task was paused by a user interrupt and is now redirected. */
export function interrupted() {
  return [
    "<system-reminder>",
    "The user interrupted you before you finished, and now directs you with the message above.",
    "Follow this direction. Your final response is returned to your parent agent as the result of its original task.",
    "</system-reminder>",
  ].join("\n")
}

/** First line of a task result whose subagent the user interrupted and then redirected. */
export const REDIRECTED = "The user interrupted this subagent and redirected it."
/** First line of a task result whose subagent the user interrupted before it resumed without their direction. */
export const INTERRUPTED = "The user interrupted this subagent before it finished."

// Result budgets: one steer, and all steers together; the most recent steers are kept.
const STEER = 2048
const TOTAL = 6144
// Anything a model could read as the block's closing tag, in any case or spacing.
const CLOSE = /<\s*\/\s*user_steering/gi

/** Task result with the user's direction to the subagent ahead of its final response; a paused task says so first. */
export function annotate(input: { paused: boolean; steers: ReadonlyArray<string>; text: string }) {
  const kept: string[] = []
  let size = 0
  for (const steer of input.steers.toReversed()) {
    // a steer cannot close its own block early
    const value = BoardStore.excerpt(steer, STEER).replace(CLOSE, "<\\/user_steering")
    const block = `<user_steering>\n${value}\n</user_steering>`
    size += Buffer.byteLength(block)
    if (size > TOTAL) break
    kept.unshift(block)
  }
  const dropped = input.steers.length - kept.length
  const note = dropped > 0 ? `(${dropped} earlier steering message${dropped === 1 ? "" : "s"} omitted)` : undefined
  const lead = input.paused ? (input.steers.length > 0 ? REDIRECTED : INTERRUPTED) : undefined
  return [lead, note, ...kept, input.text].filter((item) => !!item).join("\n\n")
}

type Steer = { id: string; text: string }
type Run = { open: boolean; steers: Steer[] }

// Live task runs by child session ID. A run is open from the task's prompt to the child until its
// result is final; only steers admitted while it is open belong to that result.
const runs = new Map<string, Run>()

/** Whether a task run on this child is open for steering. */
export function open(id: string) {
  return runs.get(id)?.open === true
}

/** Record a steer admitted on a child; false when no task run is open for it. */
export function record(id: string, steer: Steer) {
  const run = runs.get(id)
  if (!run?.open) return false
  run.steers.push(steer)
  return true
}

/**
 * Run a task's prompt to its child and settle it, collecting the steers admitted during the run.
 * The run opens before the prompt is sent, so steers on the child's first turn count. It closes
 * in the same step that checks for a steer newer than the answer, so a steer admitted after the
 * child's last turn either reopens the wait (its turn becomes the result) or is refused by
 * `admit` once closed.
 */
export const track = Effect.fn("KiloSessionSteering.track")(function* <
  M extends { info: { id: string } },
  E,
  R,
>(input: {
  child: SessionID
  send: Effect.Effect<M, E, R>
  settle: (from: M) => Effect.Effect<{ message: M; paused: boolean }, E, R>
}) {
  // a detached run only delivers a prompt; the paused run it resumes owns the steers
  if (yield* KiloTaskPause.Detached) return { ...(yield* input.settle(yield* input.send)), steers: [] as string[] }
  const run: Run = { open: true, steers: [] }
  runs.set(input.child, run)
  return yield* Effect.gen(function* () {
    let paused = false
    let from = yield* input.send
    let again = false
    while (true) {
      const done = yield* input.settle(from)
      paused = paused || done.paused
      // a steer whose turn never ran (e.g. its prompt failed) must not loop forever
      const moved = !again || done.message.info.id !== from.info.id
      const late = moved && run.steers.some((steer) => steer.id > done.message.info.id)
      if (!late) {
        run.open = false
        return { message: done.message, paused, steers: run.steers.map((steer) => steer.text) }
      }
      from = done.message
      again = true
    }
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        if (runs.get(input.child) === run) runs.delete(input.child)
      }),
    ),
  )
})

/**
 * Admit a human steer on a subagent whose task run is open. The steer gets a hidden
 * reminder so the child still answers its original task (worded for a paused
 * task when it was interrupted; `SessionPrompt.prompt` resumes the pause right
 * after this), and a background task's parent is told over the shared board (a
 * foreground parent reads it from the task result). A steer on a child whose
 * task already has its result is left alone. Failures are logged and never fail
 * prompt admission.
 */
export const admit = Effect.fn("KiloSessionSteering.admit")(function* (input: {
  session: { id: SessionID; parentID?: SessionID }
  parts: ReadonlyArray<Part>
  messageID: MessageID
  sessions: Pick<Session.Interface, "updatePart">
  jobs: Pick<BackgroundJob.Interface, "get">
  config: Config.Interface
  flags: RuntimeFlags.Info
  database: Database.Interface
}) {
  const parent = input.session.parentID
  if (!parent) return
  const steer = text(input.parts)
  if (!steer) return
  if (!record(input.session.id, { id: input.messageID, text: steer })) return
  const paused = KiloTaskPause.paused(input.session.id)
  yield* input.sessions
    .updatePart({
      id: PartID.ascending(),
      messageID: input.messageID,
      sessionID: input.session.id,
      type: "text",
      text: paused ? interrupted() : running(),
      synthetic: true,
    })
    .pipe(Effect.catchCause((cause) => Effect.logWarning("subagent steering reminder failed", { cause })))
  const job = yield* input.jobs.get(input.session.id)
  if (job?.metadata?.background !== true) return
  yield* post({
    from: input.session.id,
    to: parent,
    messageID: input.messageID,
    body: body(steer),
    config: input.config,
    flags: input.flags,
    database: input.database,
  })
})

export * as KiloSessionSteering from "./steering"
