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

const log = Log.create({ service: "workflow.build-runner" })

export type BuildCallbacks = {
  onTaskStart: (taskId: string, sessionId: string) => void
  onTaskComplete: (taskId: string, result: TaskResult) => void
  onOutput: (taskId: string, sessionId: string, line: string) => void
}

export type BuildRunnerOptions = {
  teamConfig: TeamConfig | undefined
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
