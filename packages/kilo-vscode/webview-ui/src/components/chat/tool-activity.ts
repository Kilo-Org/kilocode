/**
 * Compact tool activity — grouping and labelling, with no Solid or DOM in it so
 * it can be unit tested against real part shapes.
 *
 * Anything interactive, blocking, failed, or already carrying a richer summary
 * of its own breaks the run and keeps its existing card.
 */

import type { IconProps } from "@kilocode/kilo-ui/icon"

type Icon = IconProps["name"]

export type Category = "think" | "read" | "search" | "list" | "web" | "run" | "change" | "other"

/** Chips shown before the stack turns into a `+N` chip. */
export const CHIPS = 4

/**
 * Tools that always keep their own card. `question` and `suggest` are
 * interactive, `plan_exit` is a decision, `todowrite`/`todoread` already render
 * as a checklist, and `task` already summarizes its own child tools in
 * TaskToolExpanded.
 */
const KEEP = new Set(["question", "suggest", "plan_exit", "todowrite", "todoread", "task"])

const CATEGORY: Record<string, Category> = {
  read: "read",
  grep: "search",
  glob: "search",
  codesearch: "search",
  list: "list",
  webfetch: "web",
  websearch: "web",
  bash: "run",
  edit: "change",
  write: "change",
  apply_patch: "change",
}

export const ICON: Record<Category, Icon> = {
  think: "brain",
  read: "glasses",
  search: "magnifying-glass-menu",
  list: "bullet-list",
  web: "window-cursor",
  run: "console",
  change: "code-lines",
  other: "mcp",
}

/** Reuse the working indicator's present-tense labels and animation vocabulary. */
export const LIVE: Record<Exclude<Category, "other">, string> = {
  think: "ui.sessionTurn.status.thinking",
  read: "ui.sessionTurn.status.gatheringContext",
  search: "ui.sessionTurn.status.searchingCodebase",
  list: "ui.sessionTurn.status.gatheringContext",
  web: "ui.sessionTurn.status.searchingWeb",
  run: "ui.sessionTurn.status.runningCommands",
  change: "ui.sessionTurn.status.makingEdits",
}

/** The minimum shape the grouping needs from a message part. */
export type ActivityPart = {
  id: string
  type: string
  tool?: string
  state?: { status?: string; input?: Record<string, unknown> }
  time?: { start?: number; end?: number }
}

/** Category of a part, or undefined when the part must keep its own card. */
export function category(part: ActivityPart): Category | undefined {
  if (part.type === "reasoning") return "think"
  if (part.type !== "tool") return undefined
  if (part.state?.status === "error") return undefined
  const tool = part.tool
  if (!tool || KEEP.has(tool)) return undefined
  return CATEGORY[tool] ?? "other"
}

/**
 * Whether a part has finished. Reasoning has no status: `time.end` is set on
 * reasoning-end, and v1 parts carry no time at all, which makes them historical.
 */
export function settled(part: ActivityPart): boolean {
  if (part.type === "reasoning") return !part.time || !!part.time.end
  const status = part.state?.status
  return status === "completed" || status === "error"
}
