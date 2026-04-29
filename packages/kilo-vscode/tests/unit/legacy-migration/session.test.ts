import { describe, expect, it } from "bun:test"
import { createSession } from "../../../src/legacy-migration/sessions/lib/session"

describe("legacy migration session", () => {
  it("builds a session from legacy task metadata and the resolved project id", () => {
    const session = createSession(
      "019d3df5-d5d9-73dc-bc2c-43a6304ac62c",
      {
        id: "019d3df5-d5d9-73dc-bc2c-43a6304ac62c",
        ts: 1774861014564,
        workspace: "/workspace/testing",
        task: "Understand this project",
        mode: "code",
      },
      "project-1",
      "/workspace/testing",
    )

    expect(session.projectID).toBe("project-1")
    expect(session.directory).toBe("/workspace/testing")
    expect(session.title).toBe("Understand this project")
    expect(session.version).toBe("v2")
    expect(session.timeCreated).toBe(1774861014564)
    expect(session.timeUpdated).toBe(1774861014564)
  })

  it("creates a deterministic session id from the legacy task id", () => {
    const a = createSession("legacy-task-1", undefined, "project-1", "")
    const b = createSession("legacy-task-1", undefined, "project-1", "")

    expect(a.id).toBe(b.id)
    expect(a.id.startsWith("ses_migrated_")).toBe(true)
  })

  it("falls back to the legacy id as title when task metadata is missing", () => {
    const session = createSession("legacy-task-1", undefined, "project-1", "")

    expect(session.slug).toBe("legacy-task-1")
    expect(session.title).toBe("legacy-task-1")
    expect(session.directory).toBe("")
  })
})
