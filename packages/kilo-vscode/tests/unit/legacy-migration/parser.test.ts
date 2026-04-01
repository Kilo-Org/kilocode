import { describe, expect, it } from "bun:test"
import { createProject } from "../../../src/legacy-migration/sessions/lib/project"
import { createSession } from "../../../src/legacy-migration/sessions/lib/session"
import { createMessageID, createPartID } from "../../../src/legacy-migration/sessions/lib/ids"

const id = "019d3df5-d5d9-73dc-bc2c-43a6304ac62c"
const item = {
  id,
  ts: 1774861014564,
  task: "In this folder I need you to create 3 python files with random content, oriented towards web development",
  workspace: "/workspace/testing-4",
  mode: "code",
}

describe("legacy migration parser", () => {
  it("uses the final deterministic ids expected for migration", () => {
    const project = createProject(item)
    const session = createSession(id, item, project.id, item.workspace)
    const msg1 = createMessageID(id, 0)
    const msg2 = createMessageID(id, 1)
    const prt1 = createPartID(id, 0, 0)
    const prt2 = createPartID(id, 1, 0)

    expect(project.id).toBe(createProject(item).id)
    expect(session.id).toBe(createSession(id, item, project.id, item.workspace).id)
    expect(session.id.startsWith("ses_migrated_")).toBe(true)
    expect(msg1).toBe(createMessageID(id, 0))
    expect(msg2).toBe(createMessageID(id, 1))
    expect(msg1.startsWith("msg_migrated_")).toBe(true)
    expect(msg2.startsWith("msg_migrated_")).toBe(true)
    expect(prt1).toBe(createPartID(id, 0, 0))
    expect(prt2).toBe(createPartID(id, 1, 0))
    expect(prt1.startsWith("prt_migrated_")).toBe(true)
    expect(prt2.startsWith("prt_migrated_")).toBe(true)
  })
})
