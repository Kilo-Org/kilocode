import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { Worktree } from "@/worktree"
import { Bus } from "@/bus"
import { Log } from "@/util/log"
import { resolveTaskModel, TeamConcurrencyError } from "../team/router"
import { getConcurrencyManager } from "../team/concurrency"
import { effortToProviderOptions } from "../team/effort"
import {
  detectEscalation,
  createEscalatedResult,
  resolveEscalationTarget,
  MAX_ESCALATION_DEPTH,
} from "./escalation"
import { groupByWave } from "./executor"
import type { PlanTask, TaskResult } from "./types"
import type { TeamConfig } from "../team/config"
import BUILD_PROMPT from "./prompts/build.txt"
import { LockManager } from "./locks"
import { EventLogger } from "./events"
import { LessonStore, extractFromAgentReport } from "./learning"
import { Instance } from "@/project/instance"

const log = Log.create({ service: "workflow.build-runner" })

export type BuildCallbacks = {
  onWaveStart?: (wave: number, total: number) => void
  onPause?: (wave: number) => void
  onTaskStart: (taskId: string, sessionId: string) => void
  onTaskComplete: (taskId: string, result: TaskResult) => void
  onOutput: (taskId: string, sessionId: string, line: string) => void
}

export type BuildRunnerOptions = {
  teamConfig: TeamConfig | undefined
  lockManager?: LockManager
  eventLogger?: EventLogger
  lessonStore?: LessonStore
} & BuildCallbacks

/**
 * Build scoped permissions for a workflow task session.
 * Allows read access everywhere, write access only to task files,
 * and bash/command execution for verification commands.
 */
export function buildPermissions(taskFiles: string[]): Array<{ permission: string; action: "allow" | "deny"; pattern: string }> {
  const perms: Array<{ permission: string; action: "allow" | "deny"; pattern: string }> = [
    { permission: "read", action: "allow", pattern: "*" },
    { permission: "bash", action: "allow", pattern: "*" },
    { permission: "command", action: "allow", pattern: "*" },
  ]
  for (const file of taskFiles) {
    perms.push({ permission: "write", action: "allow", pattern: file })
    perms.push({ permission: "edit", action: "allow", pattern: file })
  }
  if (taskFiles.length === 0) {
    perms.push({ permission: "write", action: "allow", pattern: "*" })
    perms.push({ permission: "edit", action: "allow", pattern: "*" })
  }
  return perms
}

export class BuildRunner {
  private options: BuildRunnerOptions
  private pauseRequested = false
  private paused = false

  constructor(options: BuildRunnerOptions) {
    this.options = options
  }

  requestPause(): void {
    this.pauseRequested = true
  }

  isPaused(): boolean {
    return this.paused
  }

  groupWaves(tasks: PlanTask[]): Map<number, PlanTask[]> {
    return groupByWave(tasks)
  }

  // devilcode_change start - audit MA5: pre-acquire all role slots before parallel execution
  // to prevent TOCTOU oversubscription (Promise.all evaluating capacity then racing to acquire).
  async executeWave(tasks: PlanTask[]): Promise<TaskResult[]> {
    const needsWorktrees = tasks.length > 1
    log.info("executeWave", { taskCount: tasks.length, needsWorktrees })

    // Group tasks by their resolved role for batch capacity check.
    const teamConfig = this.options.teamConfig
    const concurrency = getConcurrencyManager()
    const acquired: Array<{ role: string; taskId: string }> = []

    if (teamConfig?.enabled) {
      const byRole = new Map<string, PlanTask[]>()
      for (const task of tasks) {
        const role = teamConfig.roles[task.role] ? task.role : undefined
        if (!role) continue
        if (!byRole.has(role)) byRole.set(role, [])
        byRole.get(role)!.push(task)
      }

      for (const [role, group] of byRole) {
        const max = teamConfig.roles[role].maxConcurrent
        if (concurrency.getActiveCount(role) + group.length > max) {
          // Roll back any slots already taken in this wave before throwing.
          for (const a of acquired) concurrency.release(a.role, a.taskId)
          throw new TeamConcurrencyError({ role, maxConcurrent: max })
        }
        for (const task of group) {
          concurrency.acquire(role, task.id)
          acquired.push({ role, taskId: task.id })
        }
      }
    }

    try {
      const results = await Promise.all(
        tasks.map((task) => this.executeTask(task, needsWorktrees, true)),
      )
      return results
    } finally {
      for (const a of acquired) concurrency.release(a.role, a.taskId)
    }
  }
  // devilcode_change end

  async executeAll(tasks: PlanTask[]): Promise<TaskResult[]> {
    this.paused = false
    const waves = [...this.groupWaves(tasks).entries()]
    const allResults: TaskResult[] = []
    const total = waves.length

    for (const [idx, [waveNum, waveTasks]] of waves.entries()) {
      this.options.onWaveStart?.(waveNum, total)
      log.info("starting wave", { wave: waveNum, tasks: waveTasks.length })
      const waveResults = await this.executeWave(waveTasks)
      allResults.push(...waveResults)

      const failures = waveResults.filter((r) => r.status === "failed")
      if (failures.length > 0) {
        log.info("wave failed, stopping build", {
          wave: waveNum,
          failures: failures.map((f) => f.taskId),
        })
        for (const [laterWave, laterTasks] of waves) {
          if (laterWave <= waveNum) continue
          for (const task of laterTasks) {
            const result = {
              taskId: task.id,
              status: "blocked",
              output: `Blocked: wave ${waveNum} had failures`,
              filesModified: [],
            } satisfies TaskResult
            allResults.push(result)
            this.options.onTaskComplete(task.id, result)
          }
        }
        break
      }

      if (this.pauseRequested && idx < waves.length - 1) {
        this.paused = true
        log.info("build paused after wave", { wave: waveNum })
        this.options.onPause?.(waveNum)
        break
      }
    }

    return allResults
  }

  // devilcode_change - audit MA5: slotsPreAcquired skips per-task acquire/release when the wave
  // batch path has already reserved capacity (avoids double-acquire and double-release).
  private async executeTask(task: PlanTask, useWorktree: boolean, slotsPreAcquired = false): Promise<TaskResult> {
    let worktree: Worktree.Info | undefined
    try {
      if (useWorktree) {
        worktree = await Worktree.create({ name: `wf-${task.id}` })
        log.info("worktree created", { taskId: task.id, directory: worktree.directory })
      }

      // Acquire file locks if lock manager is configured
      if (this.options.lockManager && task.files.length > 0) {
        const conflicts = await this.options.lockManager.checkConflicts(task.files)
        if (conflicts.length > 0) {
          const conflictMsg = conflicts
            .map((c) => `${c.taskId} holds lock on: ${c.files.join(", ")}`)
            .join("; ")
          log.info("file conflict detected", { taskId: task.id, conflicts: conflictMsg })
          throw new Error(`File conflict: ${conflictMsg}`)
        }
        await this.options.lockManager.acquire(task.id, task.role, task.files)
        if (this.options.eventLogger) {
          await this.options.eventLogger.log({
            eventType: "files_locked",
            taskId: task.id,
            role: task.role,
            message: `Locked files: ${task.files.join(", ")}`,
          })
        }
        log.info("files locked", { taskId: task.id, files: task.files })
      }

      // devilcode_change start - audit MA1+MA3: derive parent from team config; skip hierarchy
      // check when re-dispatching an escalated task (escalation target is acting as a new top-level
      // executor, not a child of the original parent).
      const parentRole =
        (task.escalationDepth ?? 0) > 0
          ? undefined
          : this.options.teamConfig?.routing.parentRole ?? this.options.teamConfig?.routing.defaultRole
      const resolved = resolveTaskModel({
        subagentType: task.role,
        teamConfig: this.options.teamConfig,
        parentRole,
      })
      // devilcode_change end

      // Check concurrency capacity before proceeding
      const concurrency = getConcurrencyManager()
      const roleConfig = resolved ? this.options.teamConfig?.roles[resolved.role] : undefined
      // devilcode_change start - audit MA5: skip when slot already reserved at wave level.
      if (resolved && roleConfig && !slotsPreAcquired) {
        if (!concurrency.hasCapacity(resolved.role, roleConfig.maxConcurrent)) {
          throw new TeamConcurrencyError({
            role: resolved.role,
            maxConcurrent: roleConfig.maxConcurrent,
          })
        }
      }
      // devilcode_change end

      const taskPrompt = [
        BUILD_PROMPT,
        `\n## Your Task\n`,
        `**ID:** ${task.id}`,
        `**Title:** ${task.title}`,
        `**Description:** ${task.description}`,
        `**Files to modify:** ${task.files.join(", ") || "none specified"}`,
        `**Verification:** ${task.verification.join("\n- ") || "none specified"}`,
      ].join("\n")

      const run = async () => {
        const session = await Session.create({
          title: `[workflow] ${task.title}`,
          permission: buildPermissions(task.files),
        })

        this.options.onTaskStart(task.id, session.id)

        // Build provider options from effort level when team role resolved
        const providerOptions = resolved ? effortToProviderOptions(resolved.effort) : undefined

        const message = await SessionPrompt.prompt({
          sessionID: session.id,
          ...(resolved
            ? {
                agent: resolved.role,
                model: {
                  providerID: resolved.model.providerID,
                  modelID: resolved.model.modelID,
                },
                ...(providerOptions ? { options: providerOptions } : {}),
              }
            : {}),
          parts: [{ type: "text", text: taskPrompt }],
        })

        return { message, session }
      }

      // Acquire concurrency slot before execution
      // devilcode_change - audit MA5: only acquire here when wave path did not pre-acquire.
      if (resolved && roleConfig && !slotsPreAcquired) {
        concurrency.acquire(resolved.role, task.id)
      }

      let next: { message: any; session: any }
      try {
        next = worktree
          ? await Instance.provide({
              directory: worktree.directory,
              fn: async () => {
                try {
                  return await run()
                } finally {
                  await Instance.dispose()
                }
              },
            })
          : await run()
      } finally {
        // Release concurrency slot after execution (always, even on error)
        // devilcode_change - audit MA5: matched release happens at wave level when pre-acquired.
        if (resolved && roleConfig && !slotsPreAcquired) {
          concurrency.release(resolved.role, task.id)
        }
      }

      const output = extractOutput(next.message)

      // Check for escalation signals in task output
      const escalationSignal = detectEscalation(output)
      if (escalationSignal.detected) {
        const escalatedResult = createEscalatedResult(task.id, output, escalationSignal, task.files)
        // devilcode_change start - audit MA3: resolve target role and re-dispatch instead of merely tagging.
        const teamConfig = this.options.teamConfig
        const escalationEnabled = teamConfig?.routing.escalationEnabled !== false
        const depth = task.escalationDepth ?? 0
        if (teamConfig && escalationEnabled && depth < MAX_ESCALATION_DEPTH) {
          const target = resolveEscalationTarget(task.role, escalationSignal, teamConfig)
          if (target && target.role !== task.role) {
            log.info("re-dispatching escalated task", {
              taskId: task.id,
              from: task.role,
              to: target.role,
              depth: depth + 1,
              reason: target.reason,
            })
            this.options.onTaskComplete(task.id, escalatedResult)
            const followUp: PlanTask = {
              ...task,
              role: target.role,
              escalationDepth: depth + 1,
              title: `${task.title} (escalated to ${target.role})`,
              description: `${task.description}\n\n--- Escalated from ${task.role} ---\nReason: ${target.reason}\nOriginal output:\n${output.slice(0, 1000)}`,
            }
            return await this.executeTask(followUp, useWorktree)
          }
        }
        // devilcode_change end
        this.options.onTaskComplete(task.id, escalatedResult)
        return escalatedResult
      }

      const result: TaskResult = {
        taskId: task.id,
        status: "completed",
        output,
        filesModified: task.files,
      }

      this.options.onTaskComplete(task.id, result)
      return result
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      log.error("task execution failed", { taskId: task.id, error: errMsg })

      // Attempt to capture a lesson from the failure
      if (this.options.lessonStore) {
        const lesson = extractFromAgentReport({
          trigger: errMsg,
          resolution: `Task "${task.title}" failed. Error: ${errMsg}`,
          files: task.files,
          taskTitle: task.title,
          category: "code_pattern",
        })
        if (lesson) {
          await this.options.lessonStore.save(lesson).catch((e) => {
            log.error("lesson save failed", { taskId: task.id, error: String(e) })
          })
          if (this.options.eventLogger) {
            await this.options.eventLogger.log({
              eventType: "lesson_captured",
              taskId: task.id,
              role: task.role,
              message: `Lesson captured: ${lesson.title}`,
            }).catch(() => {})
          }
          log.info("lesson captured from failure", { taskId: task.id, lessonId: lesson.id })
        }
      }

      const result: TaskResult = {
        taskId: task.id,
        status: "failed",
        output: "",
        filesModified: [],
        error: errMsg,
      }

      this.options.onTaskComplete(task.id, result)
      return result
    } finally {
      // Release file locks
      if (this.options.lockManager) {
        await this.options.lockManager.release(task.id).catch((e) => {
          log.error("lock release failed", { taskId: task.id, error: String(e) })
        })
        if (this.options.eventLogger) {
          await this.options.eventLogger.log({
            eventType: "files_unlocked",
            taskId: task.id,
            message: `Released locks for task ${task.id}`,
          }).catch(() => {})
        }
      }
      // Clean up worktree if we created one
      if (worktree) {
        await Worktree.remove({ directory: worktree.directory }).catch((e) => {
          log.error("worktree cleanup failed", { taskId: task.id, error: String(e) })
        })
      }
    }
  }
}

function extractOutput(message: { parts?: Array<{ type: string; text?: string }> } | undefined): string {
  if (!message?.parts) return ""
  return message.parts
    .filter((p) => p.type === "text" && p.text)
    .map((p) => p.text!)
    .join("\n")
    .slice(0, 2000)
}
