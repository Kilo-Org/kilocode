import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Project } from "../../src/project"
import { Revert } from "../../src/revert"
import { SessionV1 } from "../../src/session-v1"
import { SessionID } from "../../src/session-id"
import { SessionMessage } from "../../src/session-message"

describe("revert workspace outcomes", () => {
  test("preserves the current revert state outcome", () => {
    const encoded = Schema.encodeSync(Revert.State)({
      messageID: SessionMessage.ID.make("msg_test"),
      workspace: "restored",
    })

    expect(encoded.workspace).toBe("restored")
  })

  test("preserves the legacy session update outcome", () => {
    const sessionID = SessionID.descending("ses_test")
    const encoded = Schema.encodeSync(SessionV1.Event.Updated.data)({
      sessionID,
      info: {
        id: sessionID,
        slug: "test",
        projectID: Project.ID.make("project_test"),
        directory: "/repo",
        title: "Test",
        version: "7.4.21",
        time: { created: 1, updated: 1 },
        revert: { messageID: SessionV1.MessageID.make("msg_test"), workspace: "restored" },
      },
    })

    expect(encoded.info.revert?.workspace).toBe("restored")
  })
})
