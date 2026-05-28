import * as vscode from "vscode"
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
  await vscode.commands.executeCommand("workbench.action.terminal.selectToPreviousCommand")
  await selectPrevious(count - 1)
}

export async function getTerminalContents(commands = -1, opts?: TerminalLimitOptions): Promise<TerminalOutput> {
  const saved = await vscode.env.clipboard.readText()

  try {
    if (commands < 0) {
      await vscode.commands.executeCommand("workbench.action.terminal.selectAll")
    } else {
      await selectPrevious(commands)
    }

    await vscode.commands.executeCommand("workbench.action.terminal.copySelection")
    await vscode.commands.executeCommand("workbench.action.terminal.clearSelection")

    const copied = (await vscode.env.clipboard.readText()).trim()
    if (saved === copied) return { content: "", truncated: false }

    return truncateTerminalOutput(trimPrompt(copied), opts)
  } finally {
    await vscode.env.clipboard.writeText(saved)
  }
}
