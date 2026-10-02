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
export function interrupted(steer: string) {
  return [
    "<system-reminder>",
    "You were interrupted by the user before you finished.",
    `The user now directs: ${steer}`,
    "Your final response is returned to your parent agent as the result of its original task.",
    "</system-reminder>",
  ].join("\n")
}

/** First line of a task result whose subagent the user interrupted and then redirected. */
export const REDIRECTED = "The user interrupted this subagent and redirected it."
/** First line of a task result whose subagent the user interrupted before it resumed without their direction. */
export const INTERRUPTED = "The user interrupted this subagent before it finished."

type Message = { info: { id: string; role: string }; parts: ReadonlyArray<Part> }

/** Marked steer text from the user messages after `after` (the task's own prompt), oldest first. */
export function since(messages: ReadonlyArray<Message>, after: string) {
  const index = messages.findIndex((message) => message.info.id === after)
  const later = index === -1 ? messages.filter((message) => message.info.id > after) : messages.slice(index + 1)
  return later.flatMap((message) => {
    if (message.info.role !== "user") return []
    const steer = text(message.parts)
    return steer ? [steer] : []
  })
}

/** Task result with the user's direction to the subagent ahead of its final response; a paused task says so first. */
export function annotate(input: { paused: boolean; steers: ReadonlyArray<string>; text: string }) {
  const blocks = input.steers.map((steer) => `<user_steering>\n${steer}\n</user_steering>`)
  const lead = input.paused ? (blocks.length > 0 ? REDIRECTED : INTERRUPTED) : undefined
  return [lead, ...blocks, input.text].filter((item) => !!item).join("\n\n")
}

/**
 * Admit a human steer on a subagent whose task is live. The steer gets a hidden
 * reminder so the child still answers its original task (worded for a paused
 * task when it was interrupted; `SessionPrompt.prompt` resumes the pause right
 * after this), and a background task's parent is told over the shared board (a
 * foreground parent reads it from the task result). Failures are logged and
 * never fail prompt admission.
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
  const job = yield* input.jobs.get(input.session.id)
  if (job?.status !== "running") return
  const paused = KiloTaskPause.paused(input.session.id)
  yield* input.sessions
    .updatePart({
      id: PartID.ascending(),
      messageID: input.messageID,
      sessionID: input.session.id,
      type: "text",
      text: paused ? interrupted(steer) : running(),
      synthetic: true,
    })
    .pipe(Effect.catchCause((cause) => Effect.logWarning("subagent steering reminder failed", { cause })))
  if (job.metadata?.background !== true) return
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
