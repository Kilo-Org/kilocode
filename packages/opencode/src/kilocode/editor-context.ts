export interface EditorContext {
  visibleFiles?: string[]
  openTabs?: string[]
  activeFile?: string
  shell?: string
  timezone?: string
}

/**
 * Build static <env> lines from editor context.
 * These rarely change during a session and belong in the system prompt
 * so they benefit from prompt caching.
 */
export function staticEnvLines(ctx?: EditorContext): string[] {
  const now = new Date()
  const lines = [`  Today's date: ${now.toDateString()}`]
  if (ctx?.timezone) {
    const offset = -now.getTimezoneOffset()
    const sign = offset >= 0 ? "+" : "-"
    const hours = Math.floor(Math.abs(offset) / 60)
    const mins = Math.abs(offset) % 60
    lines.push(`  User timezone: ${ctx.timezone}, UTC${sign}${hours}:${mins.toString().padStart(2, "0")}`)
  }
  if (ctx?.shell) {
    lines.push(`  Default shell: ${ctx.shell}`)
  }
  return lines
}

/**
 * Build a per-message <environment_details> block from editor context.
 * These change frequently (user switches files/tabs) and belong in the
 * user message so the model always has fresh context.
 * Returns undefined when there is nothing dynamic to report.
 */
export function environmentDetails(ctx?: EditorContext): string | undefined {
  const lines: string[] = []
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
  if (lines.length === 0) return undefined
  return ["<environment_details>", ...lines, "</environment_details>"].join("\n")
}
