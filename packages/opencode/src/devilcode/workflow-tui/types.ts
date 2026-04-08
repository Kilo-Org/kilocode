// packages/opencode/src/devilcode/workflow-tui/types.ts
import type { WorkflowStage, PlanTask, PlanChallenge, ReviewVerdict, WorkflowState } from "../workflow/types"

export type TabKind = "agent" | "plan" | "challenge" | "review" | "activity"

export type TabInfo = {
  id: string
  label: string
  kind: TabKind
  roleColor?: string
  sessionId?: string
  taskId?: string
  closeable: boolean
}

export type SessionInfo = {
  sessionId: string
  taskId: string
  role: string
  status: "running" | "completed" | "failed" | "escalated"
  output: string[]
}

export type WorkflowCommand =
  | "plan"
  | "challenge"
  | "build"
  | "review"
  | "ship"
  | "retro"
  | "next"
  | "status"
  | "pause"
  | "approve"
  | "revise"
  | "back"

export type TaskStatusIcon = "✓" | "◐" | "○" | "✗" | "↑" | "◌"

export function taskStatusIcon(status: string): TaskStatusIcon {
  switch (status) {
    case "completed":
      return "✓"
    case "in_progress":
      return "◐"
    case "pending":
      return "○"
    case "failed":
      return "✗"
    case "escalated":
      return "↑"
    case "blocked":
      return "◌"
    default:
      return "○"
  }
}

export function stageColor(stage: WorkflowStage): string {
  switch (stage) {
    case "plan":
      return "cyan"
    case "challenge":
      return "yellow"
    case "contract":
      return "#00CED1"
    case "build":
      return "green"
    case "review":
      return "#FF8C00"
    case "ship":
      return "blue"
    case "retro":
      return "magenta"
  }
}

export const WORKFLOW_COMMANDS: WorkflowCommand[] = [
  "plan", "challenge", "build", "review", "ship", "retro",
  "next", "status", "pause", "approve", "revise", "back",
]

export function isWorkflowCommand(input: string): input is WorkflowCommand {
  return WORKFLOW_COMMANDS.includes(input as WorkflowCommand)
}
