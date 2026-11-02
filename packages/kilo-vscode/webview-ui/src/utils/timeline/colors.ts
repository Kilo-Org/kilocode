/**
 * Timeline bar color classification.
 *
 * Maps the v2 assistant parts to VS Code CSS variable colors. The palette keeps
 * the same variable names as the v1 extension for the part kinds v2 renders.
 */

import type { TimelinePart } from "./types"

export const palette = {
  read: "var(--tl-read, var(--vscode-textLink-foreground))",
  write: "var(--tl-write, var(--vscode-focusBorder))",
  tool: "var(--tl-tool, var(--vscode-activityBarBadge-background))",
  error: "var(--tl-error, var(--vscode-errorForeground))",
  text: "var(--tl-text, var(--vscode-descriptionForeground))",
  reasoning: "var(--tl-reasoning, var(--vscode-descriptionForeground))",
} as const

export type TimelineColor = (typeof palette)[keyof typeof palette]

const READ_TOOLS = new Set(["read", "glob", "grep", "find", "ls", "diagnostics"])
const WRITE_TOOLS = new Set(["edit", "write", "patch", "multi_edit", "multiedit", "apply_patch"])

export function color(part: TimelinePart): TimelineColor {
  if (part.type === "text") return palette.text
  if (part.type === "reasoning") return palette.reasoning
  if (part.status === "error") return palette.error
  const name = part.name.toLowerCase()
  if (READ_TOOLS.has(name)) return palette.read
  if (WRITE_TOOLS.has(name)) return palette.write
  return palette.tool
}

export function label(part: TimelinePart): string {
  if (part.type === "text") return "Text"
  if (part.type === "reasoning") return "Reasoning"
  return part.name
}
