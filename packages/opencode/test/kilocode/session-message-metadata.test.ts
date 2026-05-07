// kilocode_change - new file

import { describe, expect, test } from "bun:test"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionID, MessageID, PartID } from "../../src/session/schema"
import { Snapshot } from "../../src/snapshot"

const sessionID = SessionID.make("session")
const patch =
  "Index: a.ts\n===================================================================\n--- a.ts\t\n+++ a.ts\t\n@@ -1,2 +1,2 @@\n one\n-two\n+three\n"

function blob(size: number) {
  return "x".repeat(size)
}

function part(tool: string, metadata: Record<string, unknown>): MessageV2.Part {
  return {
    id: PartID.make(`p-${tool}`),
    sessionID,
    messageID: MessageID.make("m-assistant"),
    type: "tool",
    callID: `call-${tool}`,
    tool,
    state: {
      status: "completed",
      input: {},
      output: "ok",
      title: tool,
      metadata,
      time: { start: 0, end: 1 },
    },
  } as MessageV2.Part
}

describe("session message metadata stripping", () => {
  test("keeps bounded edit filediff patches and strips heavy fields", () => {
    const input = part("edit", {
      diff: blob(200_000),
      filediff: {
        file: "a.ts",
        patch,
        before: blob(200_000),
        after: blob(200_000),
        additions: 1,
        deletions: 1,
      },
      diagnostics: {},
    })
    const stripped = MessageV2.stripPartMetadata(input) as Extract<MessageV2.Part, { type: "tool" }>
    const meta = stripped.state.status === "completed" ? stripped.state.metadata : {}

    expect(meta.diff).toBeUndefined()
    expect(meta.filediff.before).toBeUndefined()
    expect(meta.filediff.after).toBeUndefined()
    expect(meta.filediff.patch).toBe(patch)
    expect(JSON.stringify(stripped).length).toBeLessThan(10_000)
  })

  test("keeps bounded write filediff patches and strips heavy fields", () => {
    const input = part("write", {
      diff: blob(200_000),
      filediff: {
        file: "README.md",
        patch,
        before: blob(200_000),
        after: blob(200_000),
        additions: 1,
        deletions: 1,
      },
      diagnostics: {},
    })
    const stripped = MessageV2.stripPartMetadata(input) as Extract<MessageV2.Part, { type: "tool" }>
    const meta = stripped.state.status === "completed" ? stripped.state.metadata : {}

    expect(meta.diff).toBeUndefined()
    expect(meta.filediff.before).toBeUndefined()
    expect(meta.filediff.after).toBeUndefined()
    expect(meta.filediff.patch).toBe(patch)
    expect(JSON.stringify(stripped).length).toBeLessThan(10_000)
  })

  test("keeps bounded apply_patch per-file patches and strips heavy fields", () => {
    const input = part("apply_patch", {
      diff: blob(200_000),
      files: [
        {
          filePath: "/tmp/a.ts",
          relativePath: "a.ts",
          type: "update",
          patch,
          before: blob(200_000),
          after: blob(200_000),
          additions: 1,
          deletions: 1,
        },
      ],
      diagnostics: {},
    })
    const stripped = MessageV2.stripPartMetadata(input) as Extract<MessageV2.Part, { type: "tool" }>
    const meta = stripped.state.status === "completed" ? stripped.state.metadata : {}

    expect(meta.diff).toBeUndefined()
    expect(meta.files[0].before).toBeUndefined()
    expect(meta.files[0].after).toBeUndefined()
    expect(meta.files[0].patch).toBe(patch)
    expect(JSON.stringify(stripped).length).toBeLessThan(10_000)
  })

  test("drops oversized tool patches from hydrated session metadata", () => {
    const wide = `Index: a.ts\n--- a.ts\n+++ a.ts\n@@ -1,1 +1,1 @@\n-${blob(Snapshot.MAX_DIFF_SIZE)}\n+${blob(Snapshot.MAX_DIFF_SIZE)}\n`
    const input = part("apply_patch", {
      files: [
        {
          filePath: "/tmp/a.ts",
          relativePath: "a.ts",
          type: "update",
          patch: wide,
          additions: 1,
          deletions: 1,
        },
      ],
    })
    const stripped = MessageV2.stripPartMetadata(input) as Extract<MessageV2.Part, { type: "tool" }>
    const meta = stripped.state.status === "completed" ? stripped.state.metadata : {}

    expect(meta.files[0].patch).toBeUndefined()
    expect(JSON.stringify(stripped).length).toBeLessThan(10_000)
  })
})
