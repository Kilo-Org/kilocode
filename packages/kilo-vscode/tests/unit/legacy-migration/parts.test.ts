import { describe, expect, it } from "bun:test"
import { parsePartsFromConversation } from "../../../src/legacy-migration/sessions/lib/parts/parts"
import type { LegacyApiMessage } from "../../../src/legacy-migration/sessions/lib/legacy-types"

type Data = ReturnType<typeof parsePartsFromConversation>[number]["data"]
type Text = Extract<Data, { type: "text" }>

function text(list: ReturnType<typeof parsePartsFromConversation>) {
  return list.filter((x): x is (typeof list)[number] & { data: Text } => x.data.type === "text").map((x) => x.data.text)
}

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
        {
          type: "text",
          text: "<environment_details>\nCurrent time: 2026-03-30T12:54:59+02:00\n</environment_details>",
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
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "toolu_attempt_1",
          name: "attempt_completion",
          input: {
            result: "Created 3 Python files with web development content.",
          },
        },
      ],
      ts: 1774861079951,
    },
  ]
}

describe("legacy migration parts", () => {
  it("converts plain text and text blocks into visible text parts without losing content", async () => {
    const list = parsePartsFromConversation(sample(), id, item)

    const items = text(list)

    expect(items.some((x) => x.includes("In this folder I need you to create 3 python files"))).toBe(true)
    expect(items.some((x) => x.includes("I'll create 3 Python files with web development-oriented content."))).toBe(
      true,
    )
  })

  it("drops standalone environment_details blocks but keeps the real task text", async () => {
    const list = parsePartsFromConversation(sample(), id, item)

    const items = text(list)

    expect(items.some((x) => x.includes("<environment_details>"))).toBe(false)
    expect(items.some((x) => x.includes("In this folder I need you to create 3 python files"))).toBe(true)
  })

  it("keeps only the first task block content when text exists outside the legacy task wrapper", () => {
    const list = parsePartsFromConversation(
      [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Some preamble\n<task>actual task</task>\nSome postamble",
            },
          ],
          ts: 1774861014564,
        },
      ] as LegacyApiMessage[],
      id,
      item,
    )

    expect(text(list)).toEqual(["actual task"])
  })

  it("preserves attempt_completion input.result as assistant-visible text", async () => {
    const list = parsePartsFromConversation(sample(), id, item)

    const items = text(list)

    expect(items.some((x) => x.includes("Created 3 Python files with web development content"))).toBe(true)
  })

  it("adds a visible user text part for feedback embedded in tool_result", () => {
    const list = parsePartsFromConversation(
      [
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_feedback_1",
              name: "attempt_completion",
              input: {
                result: "Done.",
              },
            },
          ],
          ts: 10,
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_feedback_1",
              content: [
                {
                  type: "text",
                  text: "The user has provided feedback on the results. Consider their input to continue the task, and then attempt completion again.\n<feedback>\nAdd two more lines\n</feedback>",
                },
              ],
            },
          ],
          ts: 11,
        },
      ] as LegacyApiMessage[],
      id,
      item,
    )

    expect(text(list)).toContain("Add two more lines")
  })

  it("does not create parts for skipped legacy entries like system messages", () => {
    const list = parsePartsFromConversation(
      [
        {
          role: "system",
          content: "ignored",
          ts: 1774861015000,
        } as unknown as LegacyApiMessage,
      ],
      id,
      item,
    )

    expect(list).toEqual([])
  })

  it("keeps part message ids aligned with imported message ids when skipped entries exist", () => {
    const list = parsePartsFromConversation(
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
      item,
    )

    const ids = list.map((x) => x.messageID)

    expect(ids.some((x) => x === "msg_legacy-task-1_2")).toBe(false)
  })

  it("uses non-colliding ids for reasoning and normal content parts in the same message", () => {
    const list = parsePartsFromConversation(
      [
        {
          role: "assistant",
          type: "reasoning",
          text: "Think first",
          content: [
            {
              type: "text",
              text: "Visible answer",
            },
          ],
          ts: 1774861015000,
        } as unknown as LegacyApiMessage,
      ],
      id,
      item,
    )

    const ids = list.map((x) => x.id)

    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
  })
})
