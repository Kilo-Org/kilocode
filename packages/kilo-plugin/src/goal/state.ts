import { KiloGoalRpc } from "@opencode/schema/kilocode/goal"
import { Option, Schema } from "effect"

/**
 * The stored goal adds the server boot that armed it. A goal stored by an earlier process comes back paused instead
 * of resuming on its own, because nothing drives it until a client or the model starts it again.
 */
export const Stored = Schema.Struct({
  ...KiloGoalRpc.State.fields,
  boot: Schema.String,
})

export type Stored = typeof Stored.Type

export const decodeStored = Schema.decodeUnknownOption(Stored)

export const PREFIX = "session-goal:"

/** Created on first use: Workers forbid random values while a module loads. */
let processBoot: string | undefined
export const boot = () => (processBoot ??= crypto.randomUUID())

export type Command =
  | { readonly kind: "status" }
  | { readonly kind: "pause" }
  | { readonly kind: "resume" }
  | { readonly kind: "clear" }
  | { readonly kind: "start"; readonly text: string }

export const MAX_OBJECTIVE = 10_000

/**
 * The `/goal` arguments. The composer uses a delimiter so an objective can also be a control word:
 * `/goal -- pause the workers`.
 */
export function parse(text: string): Command {
  const args = text.trim()
  if (args.startsWith("-- ")) return { kind: "start", text: args.slice(3).trim() }
  if (args === "") return { kind: "status" }
  if (args === "pause") return { kind: "pause" }
  if (args === "resume") return { kind: "resume" }
  if (args === "clear") return { kind: "clear" }
  return { kind: "start", text: args }
}

/** Optional fields are omitted rather than stored as undefined. */
export function defined<T extends object>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T
}

/**
 * The goal a client may see. An active goal armed by another process is paused: the stored status says what the
 * last process was doing, not what this one is driving.
 */
export function visible(goal: Stored): KiloGoalRpc.State {
  const current: KiloGoalRpc.State = {
    id: goal.id,
    text: goal.text,
    status: goal.status,
    reason: goal.reason,
    wait: goal.wait,
    updatedAt: goal.updatedAt,
  }
  if (goal.status !== "active" || goal.boot === boot()) return defined(current)
  return defined({
    ...current,
    status: "paused",
    reason: "The server restarted while the goal was active",
    wait: undefined,
  })
}

export function describe(goal: KiloGoalRpc.State) {
  const status =
    goal.status === "active"
      ? "Goal active"
      : goal.status === "paused"
        ? "Goal paused"
        : goal.status === "waiting"
          ? "Goal waiting"
          : goal.status === "blocked"
            ? "Goal blocked"
            : "Goal achieved"
  return [`${status}: ${goal.text}`, goal.reason].filter(Boolean).join("\n")
}

export const help = [
  "Usage: /goal <objective> | /goal pause | /goal resume | /goal clear",
  "A goal keeps this session working toward one objective across turns.",
  "The working model reports completion or a blocker with goal_report; completion is not independently verified.",
  "A goal with no successful action, a failed turn, or a rejected request pauses itself.",
  "Stop or /goal pause stops active work; a new message is handled first, then the goal continues.",
  "Active goals become paused after a server restart.",
].join("\n")

export function read(value: unknown) {
  return Option.getOrUndefined(decodeStored(value))
}
