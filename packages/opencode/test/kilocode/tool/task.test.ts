import { describe, expect, test } from "bun:test"
import { KiloTask } from "../../../src/kilocode/tool/task"
import { SessionID } from "../../../src/session/schema"

describe("KiloTask.Interrupted", () => {
  const sessionID = SessionID.make("ses_interrupted")
  const error = new KiloTask.Interrupted({ sessionID, activity: "inspect bug" })

  test("names the user interruption, subagent, and activity", () => {
    expect(error.name).toBe("TaskInterrupted")
    expect(error.sessionID).toBe(sessionID)
    expect(error.message).toContain("Interrupted by user")
    expect(error.message).toContain(`"inspect bug"`)
  })

  test("tells the parent not to relaunch, but keeps the task_id for a user-requested resume", () => {
    expect(error.message).toContain("Do not resume, retry, or replace this subagent on your own")
    expect(error.message).toContain("If the user asks to continue it")
    expect(error.message).toContain(`task_id="${sessionID}"`)
    // the generic resume hint reads as an instruction and made models relaunch immediately
    expect(error.message).not.toContain("can be resumed: call the task tool again")
  })
})
