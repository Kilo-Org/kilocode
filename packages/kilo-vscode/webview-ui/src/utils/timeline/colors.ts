/**
 * Timeline bar color classification.
 *
 * Maps Part types (text, tool, reasoning, step-start, step-finish, etc.)
 * to VS Code CSS variable–based colors, mirroring the legacy extension's
 * taskTimelineColorPalette from messageColors.ts.
 */

import type { Part, ToolPart } from "../../types/messages"

// ── Color palette (VS Code CSS variables) ────────────────────────────
// These mirror the legacy extension's taskTimelineColorPalette exactly.

export const palette = {
  user: "var(--tl-user, color-mix(in srgb, var(--vscode-editor-findMatchBackground) 50%, var(--vscode-errorForeground)))",
  read: "var(--tl-read, var(--vscode-textLink-foreground))",
  write: "var(--tl-write, var(--vscode-focusBorder))",
  tool: "var(--tl-tool, var(--vscode-activityBarBadge-background))",
  success: "var(--tl-success, var(--vscode-editorGutter-addedBackground))",
  error: "var(--tl-error, var(--vscode-errorForeground))",
  text: "var(--tl-text, var(--vscode-descriptionForeground))",
  reasoning: "var(--tl-reasoning, var(--vscode-descriptionForeground))",
  step: "var(--tl-step, var(--vscode-badge-background))",
  fallback: "var(--tl-fallback, var(--vscode-badge-background))",
} as const

export type TimelineColor = (typeof palette)[keyof typeof palette]

// ── File operation detection ─────────────────────────────────────────

const READ_TOOLS = new Set(["read", "glob", "grep", "find", "ls", "diagnostics", "warpgrep"])
const WRITE_TOOLS = new Set(["edit", "write", "patch", "multi_edit", "multiedit", "apply_patch"])

function isRead(name: string): boolean {
  return READ_TOOLS.has(name)
}

function isWrite(name: string): boolean {
  return WRITE_TOOLS.has(name)
}

// ── Part → color ─────────────────────────────────────────────────────

export function color(part: Part): TimelineColor {
  switch (part.type) {
    case "text":
      return palette.text

    case "reasoning":
      return palette.reasoning

    case "tool": {
      const tp = part as ToolPart
      if (tp.state.status === "error") return palette.error
      const name = tp.tool.toLowerCase()
      if (isRead(name)) return palette.read
      if (isWrite(name)) return palette.write
      return palette.tool
    }

    case "step-start":
      return palette.step

    case "step-finish":
      return palette.success

    default:
      return palette.fallback
  }
}

// ── Label for tooltip ────────────────────────────────────────────────

export function label(part: Part): string {
  switch (part.type) {
    case "text":
      return "Text"
    case "reasoning":
      return "Reasoning"
    case "tool": {
      const tp = part as ToolPart
      return tp.tool
    }
    case "step-start":
      return "Step start"
    case "step-finish":
      return "Step finish"
    default:
      return "Unknown"
  }
}
