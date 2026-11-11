import { commands, env } from "vscode"
import { truncateTerminalOutput, type TerminalLimitOptions, type TerminalOutput } from "./truncate"

function trimPrompt(content: string) {
  const lines = content.split("\n")
  const last = lines.pop()?.trim()
  if (!last) return content

  const idx = lines.reduce((found, line, index) => (line.trim().startsWith(last) ? index : found), -1)
  return lines.slice(Math.max(idx, 0)).join("\n")
}

async function selectPrevious(count: number): Promise<void> {
  if (count <= 0) return
  await commands.executeCommand("workbench.action.terminal.selectToPreviousCommand")
  await selectPrevious(count - 1)
}

/** Copies the visible terminal selection, or the whole terminal when `count` is negative, from the clipboard. */
export async function getTerminalContents(count = -1, opts?: TerminalLimitOptions): Promise<TerminalOutput> {
  const saved = await env.clipboard.readText()

  try {
    if (count < 0) {
      await commands.executeCommand("workbench.action.terminal.selectAll")
    } else {
      await selectPrevious(count)
    }

    await commands.executeCommand("workbench.action.terminal.copySelection")
    await commands.executeCommand("workbench.action.terminal.clearSelection")

    const copied = (await env.clipboard.readText()).trim()
    if (saved === copied) return { content: "", truncated: false }

    return truncateTerminalOutput(trimPrompt(copied), opts)
  } finally {
    await env.clipboard.writeText(saved)
  }
}
