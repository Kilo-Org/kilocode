import * as vscode from "vscode"

const CHANNEL_NAME = "Kilo Code · Next Edit"
const DEBUG_SETTING = "kilo-code.new.autocomplete.nextEdit.debug"

let channel: vscode.OutputChannel | null = null

function getChannel(): vscode.OutputChannel {
  if (!channel) channel = vscode.window.createOutputChannel(CHANNEL_NAME)
  return channel
}

function debugEnabled(): boolean {
  return (
    vscode.workspace.getConfiguration().get<boolean>(DEBUG_SETTING) === true ||
    process.env.KILO_NES_DEBUG === "1"
  )
}

/**
 * Append a single log line to the dedicated NES output channel. Always goes to
 * the channel (so a user troubleshooting can flip it on without rebuilding);
 * `console.log` is mirrored only when the debug setting is enabled.
 */
export function nesLog(message: string): void {
  getChannel().appendLine(`[${new Date().toISOString()}] ${message}`)
  if (debugEnabled()) console.log(`[NES] ${message}`)
}

/** Equivalent of `console.warn` for the channel. */
export function nesWarn(message: string): void {
  getChannel().appendLine(`[${new Date().toISOString()}] WARN ${message}`)
  if (debugEnabled()) console.warn(`[NES] ${message}`)
}

export function disposeLog(): void {
  channel?.dispose()
  channel = null
}
