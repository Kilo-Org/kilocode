import { describe, expect, it } from "bun:test"
import { parseMessagesFromConversation } from "../../../src/legacy-migration/sessions/lib/messages"
import type { LegacyApiMessage } from "../../../src/legacy-migration/sessions/lib/legacy-types"

const id = "019d3df5-d5d9-73dc-bc2c-43a6304ac62c"
const item = {
  id,
  ts: 1774861014564,
  task: "In this folder I need you to create 3 python files with random content, oriented towards web development",
  workspace: "/workspace/testing-4",
  mode: "code",
}

function sample(): LegacyApiMessage[] {
  return [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "<task>\nIn this folder I need you to create 3 python files with random content, oriented towards web development\n</task>",
        },
      ],
      ts: 1774861014564,
    },
    {
      role: "assistant",
      content: [
        {
          type: "text",
          text: "\n\nI'll create 3 Python files with web development-oriented content.",
        },
      ],
      ts: 1774861031791,
    },
    {
      role: "system",
      content: "ignored",
      ts: 1774861032000,
    } as unknown as LegacyApiMessage,
  ]
}

describe("legacy migration messages", () => {
  it("parses a basic legacy conversation into ordered user and assistant messages with stable ids", () => {
    const list = parseMessagesFromConversation(sample(), id, item.workspace, item)

    expect(list).toHaveLength(2)
    expect(list[0]?.data.role).toBe("user")
    expect(list[1]?.data.role).toBe("assistant")
    expect(list[0]?.id).toBeDefined()
    expect(list[1]?.id).toBeDefined()
  })

  it("creates valid assistant message metadata for the SDK/backend shape", () => {
    const list = parseMessagesFromConversation(sample(), id, item.workspace, item)
    const msg = list.find((x) => x.data.role === "assistant")

    expect(msg?.data.role).toBe("assistant")
    if (msg?.data.role !== "assistant") throw new Error("assistant message not found")
    expect(msg.data.mode).toBe("code")
    expect(msg.data.path.cwd).toBe("/workspace/testing-4")
    expect(msg.data.path.root).toBe("/workspace/testing-4")
    expect(msg.data.tokens.input).toBe(0)
    expect(msg.data.tokens.output).toBe(0)
  })

  it("ignores unsupported legacy entries instead of producing broken messages", () => {
    const list = parseMessagesFromConversation(sample(), id, item.workspace, item)

    expect(list).toHaveLength(2)
    expect(list.some((x) => x.data.role !== "user" && x.data.role !== "assistant")).toBe(false)
  })

  it("keeps assistant parentID pointing to the previous imported message when skipped entries exist", () => {
    const list = parseMessagesFromConversation(
      [
        {
          role: "user",
          content: "hello",
          ts: 1,
        },
        {
          role: "system",
          content: "ignored",
          ts: 2,
        } as unknown as LegacyApiMessage,
        {
          role: "assistant",
          content: "hi",
          ts: 3,
        },
      ],
      id,
      item.workspace,
      item,
    )

    const user = list[0]
    const assistant = list[1]

    expect(user?.id).toBeDefined()
    expect(assistant?.data.role).toBe("assistant")
    if (assistant?.data.role !== "assistant") throw new Error("assistant message not found")
    expect(assistant.data.parentID).toBe(user?.id)
  })
})
