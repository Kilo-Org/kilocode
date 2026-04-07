import type { ActiveTask } from "./types"

export type HealthConfig = {
  taskStuckTimeoutMs: number
  reviewStuckTimeoutMs: number
  mergeStuckTimeoutMs: number
}

export const DEFAULT_HEALTH_CONFIG: HealthConfig = {
  taskStuckTimeoutMs: 15 * 60 * 1000, // 15 minutes
  reviewStuckTimeoutMs: 10 * 60 * 1000, // 10 minutes
  mergeStuckTimeoutMs: 5 * 60 * 1000, // 5 minutes
}

export type HealthAlert = {
  taskId: string
  reason: string
  idleDurationMs: number
}

export type DeadlockResult = {
  type: "cycle" | "cascade"
  taskIds: string[]
  message: string
}

const TERMINAL_STATUSES = new Set(["completed", "failed", "escalated"])

export function detectStuckTasks(
  tasks: ActiveTask[],
  lastActivity: Map<string, number>,
  config: HealthConfig,
  now: number = Date.now(),
): HealthAlert[] {
  const alerts: HealthAlert[] = []
  for (const task of tasks) {
    if (TERMINAL_STATUSES.has(task.status)) continue

    const lastSeen = lastActivity.get(task.id) ?? now
    const idleMs = now - lastSeen

    const threshold =
      task.status === "in_progress" ? config.taskStuckTimeoutMs : config.taskStuckTimeoutMs

    if (idleMs > threshold) {
      alerts.push({
        taskId: task.id,
        reason: `${task.status}: no activity for ${Math.round(idleMs / 60000)} minutes`,
        idleDurationMs: idleMs,
      })
    }
  }
  return alerts
}

export function detectDeadlock(
  tasks: ActiveTask[],
  dependsOn: Map<string, string[]>,
): DeadlockResult | null {
  const blockedTasks = tasks.filter((t) => t.status === "blocked")
  if (blockedTasks.length === 0) return null

  const blockedIds = new Set(blockedTasks.map((t) => t.id))

  // DFS cycle detection using WHITE/GRAY/BLACK coloring
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2
  const color = new Map<string, number>()
  for (const id of blockedIds) color.set(id, WHITE)

  let cycleNodes: string[] | null = null

  function dfs(nodeId: string, path: string[]): boolean {
    color.set(nodeId, GRAY)
    path.push(nodeId)

    const deps = dependsOn.get(nodeId) ?? []
    for (const dep of deps) {
      if (!blockedIds.has(dep)) continue
      const depColor = color.get(dep) ?? BLACK
      if (depColor === GRAY) {
        // Found cycle — extract cycle from path
        const cycleStart = path.indexOf(dep)
        cycleNodes = path.slice(cycleStart)
        return true
      }
      if (depColor === WHITE) {
        if (dfs(dep, path)) return true
      }
    }

    color.set(nodeId, BLACK)
    path.pop()
    return false
  }

  for (const id of blockedIds) {
    if ((color.get(id) ?? BLACK) === WHITE) {
      if (dfs(id, [])) {
        return {
          type: "cycle",
          taskIds: cycleNodes!,
          message: `Deadlock: ${cycleNodes!.join(" \u2192 ")} \u2192 ${cycleNodes![0]}`,
        }
      }
    }
  }

  // No cycle found but all remaining are blocked — cascade failure
  const nonTerminal = tasks.filter((t) => !TERMINAL_STATUSES.has(t.status))
  if (nonTerminal.length > 0 && nonTerminal.every((t) => t.status === "blocked")) {
    return {
      type: "cascade",
      taskIds: nonTerminal.map((t) => t.id),
      message: `All ${nonTerminal.length} remaining tasks are blocked. An upstream dependency likely failed.`,
    }
  }

  return null
}
