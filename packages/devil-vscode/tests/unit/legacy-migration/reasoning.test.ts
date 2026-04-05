import { describe, expect, it } from "bun:test"
import { parsePartsFromConversation } from "../../../src/legacy-migration/sessions/lib/parts/parts"
import type { LegacyApiMessage } from "../../../src/legacy-migration/sessions/lib/legacy-types"

type Reasoning = Extract<ReturnType<typeof parsePartsFromConversation>[number]["data"], { type: "reasoning" }>

function reasoning(list: ReturnType<typeof parsePartsFromConversation>) {
  return list
    .filter((x): x is (typeof list)[number] & { data: Reasoning } => x.data.type === "reasoning")
    .map((x) => x.data.text)
}

const id = "legacy-reasoning-1"
const item = {
  id,
  ts: 1774861014564,
  task: "Reasoning parsing test",
  workspace: "/workspace/testing",
  mode: "code",
}

describe("legacy migration reasoning", () => {
  it("converts type reasoning plus text into a reasoning part", () => {
    const list = parsePartsFromConversation(
      [
        {
          role: "assistant",
          type: "reasoning",
          text: "I should inspect the files first.",
          content: [],
          ts: 1774861015000,
        } as unknown as LegacyApiMessage,
      ],
      id,
      item,
    )

    const out = reasoning(list)
    expect(out).toEqual(["I should inspect the files first."])
  })

  it("extracts reasoning from reasoning_content", () => {
    const list = parsePartsFromConversation(
      [
        {
          role: "assistant",
          content: [],
          reasoning_content: "I should read the markdown before answering.",
          ts: 1774861015000,
        } as unknown as LegacyApiMessage,
      ],
      id,
      item,
    )

    const out = reasoning(list)
    expect(out).toEqual(["I should read the markdown before answering."])
  })

  it("extracts readable reasoning text from reasoning_details", () => {
    const list = parsePartsFromConversation(
      [
        {
          role: "assistant",
          content: [],
          reasoning_details: [{ text: "First inspect the repo." }, { reasoning: "Then summarize the structure." }],
          ts: 1774861015000,
        } as unknown as LegacyApiMessage,
      ],
      id,
      item,
    )

    const out = reasoning(list)
    expect(out).toHaveLength(1)
    expect(out[0]).toContain("First inspect the repo.")
    expect(out[0]).toContain("Then summarize the structure.")
  })

  it("prefers explicit reasoning entries over provider-specific reasoning fields when both exist", () => {
    const list = parsePartsFromConversation(
      [
        {
          role: "assistant",
          type: "reasoning",
          text: "I should inspect the files first.",
          reasoning_content: "I should inspect the files first.",
          content: [],
          ts: 1774861015000,
        } as unknown as LegacyApiMessage,
      ],
      id,
      item,
    )

    const out = reasoning(list)
    expect(out).toEqual(["I should inspect the files first."])
  })
})
