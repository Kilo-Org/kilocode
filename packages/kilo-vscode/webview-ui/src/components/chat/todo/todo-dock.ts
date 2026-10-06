/**
 * Todo progress for the session dock.
 *
 * The dock shows the todo list as one small chip next to the working spinner,
 * and next to the Goal control when the session is idle. These helpers hold
 * the decisions that do not need the DOM: what counts as progress, when the
 * chip shows, when a list just finished, and how much of the chip fits.
 */

import type { TodoItem } from "../../../types/messages"

export interface TodoStats {
  /** Items that count toward progress. Cancelled items do not. */
  live: TodoItem[]
  done: number
  total: number
  all: boolean
  /** The item the agent works on now, else the next one. */
  active?: TodoItem
}

export function todoStats(items: TodoItem[]): TodoStats {
  const live = items.filter((item) => item.status !== "cancelled")
  const done = live.filter((item) => item.status === "completed").length
  const active = live.find((item) => item.status === "in_progress") ?? live.find((item) => item.status === "pending")
  return { live, done, total: live.length, all: live.length > 0 && done === live.length, active }
}

/**
 * Whether the dock shows the list. A list with open items always shows. A
 * finished list stays until a newer user message starts another run, so it
 * comes from the messages and a reload gives the same result.
 *
 * `last` is the message of the latest todowrite call and `user` the latest
 * user message. Message IDs sort by time.
 */
export function todoVisible(stats: TodoStats, last: string | undefined, user: string | undefined) {
  if (stats.total === 0) return false
  if (!stats.all) return true
  if (!last || !user) return true
  return user < last
}

/**
 * The list of one session went from open items to all done. A list that
 * arrives already done (a reload, a session switch, a replaced list) is not a
 * finish, so it does not celebrate. Todo items have no ID, so a list counts
 * as the same list when an item that was open is now done with the same text.
 */
export function todoFinished(prev: TodoStats, next: TodoStats) {
  if (prev.total === 0 || prev.all || !next.all) return false
  const open = new Set(prev.live.filter((item) => item.status !== "completed").map((item) => item.content))
  return next.live.some((item) => open.has(item.content))
}

/** Widest title the chip shows, so a long item does not take the whole row. */
export const TODO_TITLE_MAX = 200
/** Narrowest title worth showing. Below this the title hides. */
const TODO_TITLE_MIN = 56

interface FitInput {
  /** Room for the trailing group: the chip and the goal badge. */
  space: number
  /** The chip without its count and title. */
  chip: number
  count: number
  /** Natural width of the title. */
  title: number
  /** Goal badge widths, when a goal shows. */
  goal?: { full: number; compact: number }
  /** Gap between the chip and the goal badge. */
  gap: number
}

export interface TodoFit {
  /** Title width cap in px. Zero hides the title. */
  title: number
  count: boolean
  /** The goal badge shows its icon only. */
  compact: boolean
}

/**
 * How much of the trailing group fits. It collapses in this order: the title
 * truncates, the goal label hides, the title hides, the count hides. The ring
 * always shows. Plan with natural widths, never the painted ones, so a
 * collapse cannot feed back into the next plan.
 */
export function todoFit(input: FitInput): TodoFit {
  const title = Math.min(input.title, TODO_TITLE_MAX)
  const full = input.goal ? input.goal.full + input.gap : 0
  const compact = input.goal ? input.goal.compact + input.gap : 0
  const base = input.chip + input.count
  const room = (goal: number) => Math.floor(input.space - base - goal)
  if (title > 0 && room(full) >= Math.min(title, TODO_TITLE_MIN))
    return { title: Math.min(title, room(full)), count: true, compact: false }
  if (title > 0 && room(compact) >= Math.min(title, TODO_TITLE_MIN))
    return { title: Math.min(title, room(compact)), count: true, compact: !!input.goal }
  // A title that did not fit already took the goal label, so the label only
  // stays when there was no title to show.
  if (title === 0 && base + full <= input.space) return { title: 0, count: true, compact: false }
  if (base + compact <= input.space) return { title: 0, count: true, compact: !!input.goal }
  return { title: 0, count: false, compact: !!input.goal }
}
