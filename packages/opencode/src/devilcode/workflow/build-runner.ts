import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { Worktree } from "@/worktree"
import { Bus } from "@/bus"
import { Log } from "@/util/log"
import { resolveTaskModel } from "../team/router"
import { groupByWave } from "./executor"
import type { PlanTask, TaskResult } from "./types"
import type { TeamConfig } from "../team/config"
import BUILD_PROMPT from "./prompts/build.txt"
import { LockManager } from "./locks"
import { EventLogger } from "./events"
import { LessonStore, extractFromAgentReport } from "./learning"

const log = Log.create({ service: "workflow.build-runner" })

export type BuildCallbacks = {
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

export class BuildRunner {
  private options: BuildRunnerOptions

  constructor(options: BuildRunnerOptions) {
    this.options = options
  }

  groupWaves(tasks: PlanTask[]): Map<number, PlanTask[]> {
    return groupByWave(tasks)
  }

  async executeWave(tasks: PlanTask[]): Promise<TaskResult[]> {
    const needsWorktrees = tasks.length > 1
    log.info("executeWave", { taskCount: tasks.length, needsWorktrees })

    const results = await Promise.all(
      tasks.map((task) => this.executeTask(task, needsWorktrees)),
    )
    return results
  }

  async executeAll(tasks: PlanTask[]): Promise<TaskResult[]> {
    const waves = this.groupWaves(tasks)
    const allResults: TaskResult[] = []

    for (const [waveNum, waveTasks] of waves) {
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
            allResults.push({
              taskId: task.id,
              status: "blocked",
              output: `Blocked: wave ${waveNum} had failures`,
              filesModified: [],
            })
          }
        }
        break
      }
    }

    return allResults
  }

  private async executeTask(task: PlanTask, useWorktree: boolean): Promise<TaskResult> {
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

      const resolved = resolveTaskModel({
        subagentType: task.role,
        teamConfig: this.options.teamConfig,
        parentRole: "orchestrator",
      })

      const session = await Session.create({
        title: `[workflow] ${task.title}`,
        permission: [
          { permission: "*", action: "allow", pattern: "*" },
        ],
      })

      this.options.onTaskStart(task.id, session.id)

      const taskPrompt = [
        BUILD_PROMPT,
        `\n## Your Task\n`,
        `**ID:** ${task.id}`,
        `**Title:** ${task.title}`,
        `**Description:** ${task.description}`,
        `**Files to modify:** ${task.files.join(", ") || "none specified"}`,
        `**Verification:** ${task.verification.join("\n- ") || "none specified"}`,
      ].join("\n")

      const message = await SessionPrompt.prompt({
        sessionID: session.id,
        ...(resolved
          ? {
              model: {
                providerID: resolved.model.providerID,
                modelID: resolved.model.modelID,
              },
            }
          : {}),
        parts: [{ type: "text", text: taskPrompt }],
      })

      const result: TaskResult = {
        taskId: task.id,
        status: "completed",
        output: extractOutput(message),
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

function extractOutput(message: any): string {
  if (!message?.parts) return ""
  return message.parts
    .filter((p: any) => p.type === "text")
    .map((p: any) => p.text)
    .join("\n")
    .slice(0, 2000)
}
