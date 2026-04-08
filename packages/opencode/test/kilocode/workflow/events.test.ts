// packages/opencode/test/kilocode/workflow/events.test.ts
import { describe, test, expect, beforeEach } from "bun:test"
import { EventLogger, type WorkflowEvent, type EventType } from "@/devilcode/workflow/events"
import fs from "fs/promises"
import path from "path"
import os from "os"

describe("EventLogger", () => {
  let tmpDir: string
  let logger: EventLogger

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "events-test-"))
    logger = new EventLogger(tmpDir)
  })

  test("log and readAll", async () => {
    await logger.log({ eventType: "task_started", taskId: "T-001", message: "Started" })
    await logger.log({ eventType: "task_completed", taskId: "T-001", message: "Done" })
    const events = await logger.readAll()
    expect(events).toHaveLength(2)
    expect(events[0].eventType).toBe("task_started")
    expect(events[1].eventType).toBe("task_completed")
  })

  test("readRecent returns last N", async () => {
    for (let i = 0; i < 10; i++) {
      await logger.log({ eventType: "task_started", message: `Event ${i}` })
    }
    const recent = await logger.readRecent(3)
    expect(recent).toHaveLength(3)
    expect(recent[2].message).toBe("Event 9")
  })

  test("handles empty log", async () => {
    const events = await logger.readAll()
    expect(events).toHaveLength(0)
  })

  test("skips malformed lines", async () => {
    const logPath = path.join(tmpDir, "events.jsonl")
    await fs.writeFile(
      logPath,
      '{"eventType":"task_started","message":"OK","timestamp":"2026-01-01T00:00:00Z"}\nbroken line\n{"eventType":"task_completed","message":"Done","timestamp":"2026-01-01T00:01:00Z"}\n',
    )
    const events = await logger.readAll()
    expect(events).toHaveLength(2)
  })
})
