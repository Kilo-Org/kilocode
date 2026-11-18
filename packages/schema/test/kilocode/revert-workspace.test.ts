import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { SessionMessage } from "../../src/session-message.js"
import { PersistedRevert, Revert } from "../../src/session-revert.js"

describe("revert workspace outcomes", () => {
  test("preserves the workspace outcome and omits it when absent", () => {
    const messageID = SessionMessage.ID.make("msg_test")
    expect(Schema.encodeSync(Revert)(Schema.decodeUnknownSync(Revert)({ messageID }))).toEqual({
      messageID,
    })
    expect(
      Schema.encodeSync(Revert)(Schema.decodeUnknownSync(Revert)({ messageID, workspace: "restored" })),
    ).toEqual({
      messageID,
      workspace: "restored",
    })
  })

  test("preserves the workspace outcome when decoding a legacy persisted revert", () => {
    const messageID = SessionMessage.ID.make("msg_test")
    // `Revert` needs `FileDiff.Info.file`, so a `path` entry only fits the legacy shape. Without it this input would
    // decode as a current revert and never reach the legacy transform.
    const decoded = Schema.decodeUnknownSync(PersistedRevert)({
      messageID,
      files: [{ path: "math.ts", status: "modified", additions: 1, deletions: 1, patch: "..." }],
      workspace: "snapshots-disabled",
    })
    expect(decoded.workspace).toBe("snapshots-disabled")
    expect(decoded.files?.[0]?.file).toBe("math.ts")
  })
})
