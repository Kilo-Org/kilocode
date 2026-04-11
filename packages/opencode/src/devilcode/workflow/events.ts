// packages/opencode/src/devilcode/workflow/events.ts
import fs from "fs/promises"
import path from "path"
import { Mutex } from "./mutex"
import { Log } from "../../util/log"

export type EventType =
  | "plan_created"
  | "task_created"
  | "task_started"
  | "task_completed"
  | "task_failed"
  | "task_escalated"
  | "files_locked"
  | "files_unlocked"
  | "lesson_captured"
  | "preflight_check"
  | "quality_gate_passed"
  | "quality_gate_failed"
  | "stage_advanced"
  | "contract_generated"

export type WorkflowEvent = {
  eventType: EventType
  taskId?: string
  role?: string
  message: string
  durationMs?: number
  metadata?: Record<string, unknown>
  timestamp?: string
}

const log = Log.create({ service: "workflow.events" })

export class EventLogger {
  private logPath: string
  private mutex = new Mutex()

  constructor(planningDir: string) {
    this.logPath = path.join(planningDir, "events.jsonl")
  }

  async log(event: Omit<WorkflowEvent, "timestamp"> & { timestamp?: string }): Promise<void> {
    return this.mutex.run(async () => {
      const entry: WorkflowEvent = {
        ...event,
        timestamp: event.timestamp ?? new Date().toISOString(),
      }
      const line = JSON.stringify(entry) + "\n"
      await fs.appendFile(this.logPath, line)
    })
  }

  async readAll(): Promise<WorkflowEvent[]> {
    try {
      const content = await fs.readFile(this.logPath, "utf-8")
      const lines = content.split("\n").filter((line) => line.trim().length > 0)
      let corruptLines = 0
      const events = lines
        .map((line) => {
          try {
            return JSON.parse(line) as WorkflowEvent
          } catch (parseError) {
            log.warn("corrupted event log entry", {
              line: line.substring(0, 100),
              error: parseError,
            })
            corruptLines++
            return null
          }
        })
        .filter((e): e is WorkflowEvent => e !== null)
      if (corruptLines > 0) {
        log.error("event log has corruption", {
          path: this.logPath,
          corruptLines,
          totalLines: lines.length,
        })
      }
      return events
    } catch {
      return []
    }
  }

  async readRecent(count: number): Promise<WorkflowEvent[]> {
    try {
      const content = await fs.readFile(this.logPath, "utf-8")
      const lines = content.split("\n").filter((line) => line.trim().length > 0)
      const tail = lines.slice(-count)
      let corruptLines = 0
      const events = tail
        .map((line) => {
          try {
            return JSON.parse(line) as WorkflowEvent
          } catch (parseError) {
            log.warn("corrupted event log entry", {
              line: line.substring(0, 100),
              error: parseError,
            })
            corruptLines++
            return null
          }
        })
        .filter((e): e is WorkflowEvent => e !== null)
      if (corruptLines > 0) {
        log.error("event log has corruption", {
          path: this.logPath,
          corruptLines,
          totalLines: lines.length,
        })
      }
      return events
    } catch {
      return []
    }
  }
}
