export interface EditorContext {
  visibleFiles?: string[]
  openTabs?: string[]
  activeFile?: string
  shell?: string
  timezone?: string
}

function formatDate(timezone?: string): string[] {
  const now = new Date()
  const lines = [`  Today's date: ${now.toDateString()}`]
  if (timezone) {
    const offset = -now.getTimezoneOffset()
    const sign = offset >= 0 ? "+" : "-"
    const hours = Math.floor(Math.abs(offset) / 60)
    const mins = Math.abs(offset) % 60
    lines.push(`  User timezone: ${timezone}, UTC${sign}${hours}:${mins.toString().padStart(2, "0")}`)
  }
  return lines
}

/**
 * Build additional <env> lines from VS Code editor context.
 * Returns an array of pre-formatted `  key: value` strings.
 */
export function editorContextEnvLines(ctx?: EditorContext): string[] {
  const lines = formatDate(ctx?.timezone)
  if (ctx?.shell) {
    lines.push(`  Default shell: ${ctx.shell}`)
  }
  if (ctx?.activeFile) {
    lines.push(`  Active file: ${ctx.activeFile}`)
  }
  if (ctx?.visibleFiles?.length) {
    lines.push(`  Visible files: ${ctx.visibleFiles.join(", ")}`)
  }
  if (ctx?.openTabs?.length) {
    lines.push(`  Open tabs: ${ctx.openTabs.join(", ")}`)
  }
  return lines
}
