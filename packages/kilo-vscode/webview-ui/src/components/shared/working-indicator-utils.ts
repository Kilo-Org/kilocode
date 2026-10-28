// main's working-indicator-utils.ts, session-timing.ts and computeStatus (context/session-utils.ts) over v2 data.
// v2 has no "retry" or "offline" session status: a retry is the `retry` field of the running assistant step, so it
// counts as working through the "running" status.
import type { DataSessionStatus } from "@opencode/client/solid"
import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode/client"

/**
 * Banked time from previous running stretches (`active`) and the start of the current running stretch (`since`,
 * absent while parked on a permission or question).
 */
export type Timing = { active: number; since?: number }

/** Total elapsed active milliseconds, including the current running stretch. */
export function active(timing: Timing, now: number): number {
  if (timing.since === undefined) return timing.active
  return timing.active + Math.max(0, now - timing.since)
}

/** Bank the current running stretch (if any) and stop the clock. */
export function hold(timing: Timing, now: number): Timing {
  if (timing.since === undefined) return timing
  return { active: timing.active + Math.max(0, now - timing.since) }
}

export function tracksElapsed(
  status: DataSessionStatus,
  submitting: boolean,
  timing: Timing | undefined,
): timing is Timing {
  return timing !== undefined && (status !== "idle" || submitting)
}

/**
 * Whether the session dock shows the working indicator. A retry counts as working: its countdown and Cancel action
 * belong in the dock. This is the dock's single decision point.
 */
export function showsWorking(status: DataSessionStatus, submitting: boolean, blocked: boolean): boolean {
  if (blocked) return false
  return submitting || status !== "idle"
}

type T = (key: string) => string

/**
 * main's computeStatus with the v2 names of the same tools: `subagent` is main's `task`, `shell` is main's `bash`.
 * Other tools have no label, as on main.
 */
export function computeStatus(item: SessionMessageAssistant["content"][number] | undefined, t: T): string | undefined {
  if (!item) return undefined
  if (item.type === "tool") {
    switch (item.name) {
      case "subagent":
        return t("ui.sessionTurn.status.delegating")
      case "todowrite":
      case "todoread":
        return t("ui.sessionTurn.status.planning")
      case "read":
        return t("ui.sessionTurn.status.gatheringContext")
      case "list":
      case "grep":
      case "glob":
        return t("ui.sessionTurn.status.searchingCodebase")
      case "webfetch":
        return t("ui.sessionTurn.status.searchingWeb")
      case "edit":
      case "write":
        return t("ui.sessionTurn.status.makingEdits")
      case "shell":
        return t("ui.sessionTurn.status.runningCommands")
      default:
        return undefined
    }
  }
  if (item.type === "reasoning") return t("ui.sessionTurn.status.thinking")
  return t("session.status.writingResponse")
}

/**
 * main's session statusText: the label of the last content item of the newest assistant step after the active user
 * message. `pending` holds the IDs of user input that is not delivered yet, which is not the active turn.
 */
export function statusText(messages: SessionMessageInfo[], pending: ReadonlySet<string>, t: T): string {
  const thinking = t("ui.sessionTurn.status.thinking")
  const start = messages.findLastIndex((item) => item.type === "user" && !pending.has(item.id))
  if (start < 0) return thinking
  for (let i = messages.length - 1; i > start; i--) {
    const message = messages[i]
    if (message.type !== "assistant") continue
    if (message.content.length === 0) return thinking
    return computeStatus(message.content.at(-1), t) ?? t("ui.sessionTurn.status.consideringNextSteps")
  }
  return thinking
}
