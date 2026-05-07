import { describe, expect, it } from "bun:test"
import { parsePartsFromConversation } from "../../../src/legacy-migration/sessions/lib/parts/parts"
import type { LegacyApiMessage } from "../../../src/legacy-migration/sessions/lib/legacy-types"

type Tool = Extract<ReturnType<typeof parsePartsFromConversation>[number]["data"], { type: "tool" }>

function tools(list: ReturnType<typeof parsePartsFromConversation>) {
  return list.filter((x): x is (typeof list)[number] & { data: Tool } => x.data.type === "tool").map((x) => x.data)
}

const id = "legacy-task-1"
const item = {
  id,
  ts: 1774861014564,
  task: "Tool parsing test",
  workspace: "/workspace/testing",
  mode: "code",
}

function fallback(): LegacyApiMessage[] {
  return [
    {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "toolu_fallback_1",
          name: "read_file",
          input: { path: "app.py" },
        },
      ],
      ts: 1774861015000,
    },
  ]
}

function merged(): LegacyApiMessage[] {
  return [
    {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "toolu_merge_1",
          name: "read_file",
          input: { path: "app.py" },
        },
      ],
      ts: 1774861015000,
    },
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_merge_1",
          content: [
            {
              type: "text",
              text: "File: app.py\nHello world",
            },
          ],
        },
      ],
      ts: 1774861016000,
    },
  ]
}

function noTextResult(): LegacyApiMessage[] {
  return [
    {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "toolu_merge_2",
          name: "read_file",
          input: { path: "app.py" },
        },
      ],
      ts: 1774861015000,
    },
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_merge_2",
          content: [],
        },
      ],
      ts: 1774861016000,
    },
  ]
}

describe("legacy migration tools", () => {
  it("creates a fallback tool part from tool_use when there is no matching tool_result", () => {
    const list = parsePartsFromConversation(fallback(), id, item)
    const out = tools(list)

    expect(out).toHaveLength(1)
    expect(out[0]?.tool).toBe("read_file")
    expect(out[0]?.state.status).toBe("completed")
  })

  it("merges tool_use and tool_result into one completed tool part using the correct tool id", () => {
    const list = parsePartsFromConversation(merged(), id, item)
    const out = tools(list)

    expect(out).toHaveLength(1)
    expect(out[0]?.callID).toBe("toolu_merge_1")
    expect(out[0]?.tool).toBe("read_file")
    if (out[0]?.state.status !== "completed") throw new Error("tool was not completed")
    expect(out[0].state.output).toContain("File: app.py")
  })

  it("does not duplicate a tool part when a matching tool_result exists later in the conversation", () => {
    const list = parsePartsFromConversation(merged(), id, item)
    const out = tools(list)

    expect(out).toHaveLength(1)
  })

  it("falls back to the tool name when tool_result has no readable text content", () => {
    const list = parsePartsFromConversation(noTextResult(), id, item)
    const out = tools(list)

    expect(out).toHaveLength(1)
    if (out[0]?.state.status !== "completed") throw new Error("tool was not completed")
    expect(out[0].state.output).toBe("read_file")
  })
})
