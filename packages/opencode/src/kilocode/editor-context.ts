import { Schema, Types } from "effect"

export const EditorContext = Schema.Struct({
  directory: Schema.optional(Schema.String),
  worktree: Schema.optional(Schema.String),
  visibleFiles: Schema.optional(Schema.Array(Schema.String)),
  openTabs: Schema.optional(Schema.Array(Schema.String)),
  activeFile: Schema.optional(Schema.String),
  shell: Schema.optional(Schema.String),
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
 */
function timestamp(now: Date): string {
  return now.toISOString().replace(/\.\d+Z$/, "Z")
}

export function environmentDetails(ctx?: EditorContext, now = new Date()): string {
  const lines: string[] = [`Message time: ${timestamp(now)}`]
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
  return ["<environment_details>", ...lines, "</environment_details>"].join("\n")
}
