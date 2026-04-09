export interface EditorContext {
  visibleFiles?: string[]
  openTabs?: string[]
  activeFile?: string
  shell?: string
}

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
 * Always includes at least the current timestamp.
 */
function timestamp(): string {
  const now = new Date()
  const offset = -now.getTimezoneOffset()
  const sign = offset >= 0 ? "+" : "-"
  const h = Math.floor(Math.abs(offset) / 60)
    .toString()
    .padStart(2, "0")
  const m = (Math.abs(offset) % 60).toString().padStart(2, "0")
  const pad = (n: number) => n.toString().padStart(2, "0")
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}${sign}${h}:${m}`
}

export function environmentDetails(ctx?: EditorContext): string {
  const lines: string[] = [`Current time: ${timestamp()}`]
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
