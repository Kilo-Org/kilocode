import { Schema, Types } from "effect"

export const EditorContext = Schema.Struct({
  directory: Schema.optional(Schema.String),
  worktree: Schema.optional(Schema.String),
  visibleFiles: Schema.optional(Schema.Array(Schema.String)),
  openTabs: Schema.optional(Schema.Array(Schema.String)),
  activeFile: Schema.optional(Schema.String),
  shell: Schema.optional(Schema.String),
  timezone: Schema.optional(Schema.String),
})
export type EditorContext = Types.DeepMutable<Schema.Schema.Type<typeof EditorContext>>

/**
 * Build static <env> lines from editor context.
 * These rarely change during a session and belong in the system prompt
 * so they benefit from prompt caching.
 */
export function staticEnvLines(ctx?: EditorContext): string[] {
  const lines: string[] = []
  if (ctx?.shell) {
    lines.push(`  Default shell: ${ctx.shell}`)
  }
  return lines
}

/**
 * Build a per-message <environment_details> block from editor context.
 * These change frequently (user switches files/tabs) and belong in the
 * user message so the model always has fresh context.
 * Always includes at least the supplied message timestamp.
 * The leading blank lines separate the block from the user's own text when
 * the block is appended as an adjacent content part, so models do not treat
 * it as a continuation of the user's content (kilocode#13110).
 */
function timestamp(now: Date): string {
  return now.toISOString().replace(/\.\d+Z$/, "Z")
}

export function hostTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined
  } catch {
    return undefined
  }
}

function localTime(now: Date, tz?: string): string | undefined {
  try {
    // The CLI host timezone also governs offset-less scheduled wakeups. A remote
    // CLI host may use a different timezone from its VS Code client.
    // Legacy messages have no recorded timezone and keep their UTC-only block.
    if (!tz) return undefined
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZoneName: "longOffset",
    }).formatToParts(now)
    const part = (type: string) => parts.find((item) => item.type === type)?.value
    const date = [part("year"), part("month"), part("day")]
    const time = [part("hour"), part("minute")]
    const offset = part("timeZoneName")?.replace(/^GMT/, "UTC")
    if (date.some((value) => !value) || time.some((value) => !value) || !offset) return undefined
    return `${date.join("-")} ${time.join(":")} (${tz}, ${offset === "UTC" ? "UTC+00:00" : offset})`
  } catch {
    return undefined
  }
}

export function environmentDetails(ctx?: EditorContext, now = new Date()): string {
  const lines: string[] = [`Message time: ${timestamp(now)}`]
  const local = localTime(now, ctx?.timezone)
  if (local) lines.push(`Local time: ${local}`)
  if (ctx?.directory) {
    lines.push(`Working directory: ${ctx.directory}`)
  }
  if (ctx?.worktree) {
    lines.push(`Workspace root folder: ${ctx.worktree}`)
  }
  if (ctx?.activeFile) {
    lines.push(`Active file: ${ctx.activeFile}`)
  }
  if (ctx?.visibleFiles?.length) {
    lines.push(`Visible files:`)
    for (const f of ctx.visibleFiles) {
      lines.push(`  ${f}`)
    }
  }
  if (ctx?.openTabs?.length) {
    lines.push(`Open tabs:`)
    for (const f of ctx.openTabs) {
      lines.push(`  ${f}`)
    }
  }
  return ["", "", "<environment_details>", ...lines, "</environment_details>"].join("\n")
}
