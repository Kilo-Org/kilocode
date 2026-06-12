/**
 * Helpers to read and watch the user's integrated-terminal font settings.
 *
 * VS Code's integrated terminal falls back to the editor font family when
 * its own family is unset. Font size has a separate platform default. We
 * replicate those settings for Agent Manager xterm instances.
 */

import * as vscode from "vscode"

export interface TerminalFont {
  fontFamily: string
  fontSize: number
}

const FALLBACK = "Menlo, Monaco, 'Courier New', monospace"
const SIZE = process.platform === "darwin" ? 12 : 14

export function resolveTerminalFont(
  family: string | undefined,
  size: number | undefined,
  editor: string | undefined,
): TerminalFont {
  return {
    fontFamily: family?.trim() || editor?.trim() || FALLBACK,
    fontSize: size ?? SIZE,
  }
}

/** Resolve the user's integrated-terminal font, mirroring VS Code's own
 *  family fallback while preserving the terminal's independent size. */
export function readTerminalFont(): TerminalFont {
  const term = vscode.workspace.getConfiguration("terminal.integrated")
  const editor = vscode.workspace.getConfiguration("editor")
  return resolveTerminalFont(
    term.get<string>("fontFamily"),
    term.get<number>("fontSize"),
    editor.get<string>("fontFamily"),
  )
}

/** True when a config change affects the effective terminal family or size. */
export function affectsTerminalFont(e: vscode.ConfigurationChangeEvent): boolean {
  return (
    e.affectsConfiguration("terminal.integrated.fontFamily") ||
    e.affectsConfiguration("terminal.integrated.fontSize") ||
    e.affectsConfiguration("editor.fontFamily")
  )
}

/** Subscribe to terminal-font config changes. Returns a cleanup function. */
export function watchTerminalFont(callback: (font: TerminalFont) => void): () => void {
  const sub = vscode.workspace.onDidChangeConfiguration((e) => {
    if (affectsTerminalFont(e)) callback(readTerminalFont())
  })
  return () => sub.dispose()
}
