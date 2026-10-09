import { describe, expect, test } from "bun:test"
import { normalizeToolCallBody, normalizeToolCallContent } from "../../../src/kilocode/provider/provider"

const toolBody = (content: unknown) =>
  JSON.stringify({
    model: "MBZUAI-IFM/K2-Think-v2",
    chat_template_kwargs: { reasoning_effort: "high" },
    stream: true,
    messages: [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content,
        reasoning_content: "thinking",
        tool_calls: [{ id: "call_1", type: "function", function: { name: "search", arguments: "{}" } }],
      },
      { role: "tool", tool_call_id: "call_1", content: "found 3" },
    ],
  })

describe("normalizeToolCallBody", () => {
  test("rewrites null content on assistant tool-call messages", () => {
    const out = JSON.parse(normalizeToolCallBody(toolBody(null)))
    expect(out.messages[2].content).toBe("")
    expect(out.messages[2].reasoning_content).toBe("thinking")
    expect(out.messages[2].tool_calls).toHaveLength(1)
    expect(out.chat_template_kwargs).toEqual({ reasoning_effort: "high" })
    expect(out.messages[0]).toEqual({ role: "system", content: "You are helpful." })
    expect(out.messages[3]).toEqual({ role: "tool", tool_call_id: "call_1", content: "found 3" })
  })

  test("keeps non-null content byte identical", () => {
    const body = toolBody("looking into it")
    expect(normalizeToolCallBody(body)).toBe(body)
  })

  test("only touches assistant messages", () => {
    const body = JSON.stringify({
      messages: [
        { role: "user", content: null, tool_calls: [{ id: "x" }] },
        { role: "assistant", content: null, tool_calls: [] },
      ],
    })
    const out = JSON.parse(normalizeToolCallBody(body))
    expect(out.messages[0].content).toBeNull()
    expect(out.messages[1].content).toBe("")
  })

  test("ignores bodies without tool_calls, messages, or JSON", () => {
    const plain = JSON.stringify({ messages: [{ role: "user", content: "hi" }] })
    expect(normalizeToolCallBody(plain)).toBe(plain)
    const noMessages = JSON.stringify({ tool_calls: [] })
    expect(normalizeToolCallBody(noMessages)).toBe(noMessages)
    expect(normalizeToolCallBody('{"tool_calls":')).toBe('{"tool_calls":')
  })

  test("flattens multi-part user content arrays to their text", () => {
    const body = JSON.stringify({
      model: "IFM/K2-Horizon-375B-A23B",
      stream: true,
      messages: [
        { role: "system", content: "You are helpful." },
        {
          role: "user",
          content: [
            { type: "text", text: "Use the bash tool to create hello.txt." },
            { type: "text", text: "<environment_details>\nWorking directory: /tmp\n</environment_details>" },
          ],
        },
      ],
    })
    const out = JSON.parse(normalizeToolCallBody(body))
    expect(out.messages[1].content).toBe(
      "Use the bash tool to create hello.txt.\n<environment_details>\nWorking directory: /tmp\n</environment_details>",
    )
    expect(out.messages[0]).toEqual({ role: "system", content: "You are helpful." })
  })

  test("leaves content arrays with non-text parts untouched", () => {
    const body = JSON.stringify({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "look at this" },
            { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
          ],
        },
      ],
    })
    const out = JSON.parse(normalizeToolCallBody(body))
    expect(out.messages[0].content).toEqual([
      { type: "text", text: "look at this" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
    ])
  })
})

describe("normalizeToolCallContent", () => {
  test("delegates string bodies and passes everything else through", () => {
    const bytes = new Uint8Array([1, 2, 3])
    expect(normalizeToolCallContent(bytes)).toBe(bytes)
    expect(normalizeToolCallContent(null)).toBeNull()
    const body = toolBody(null)
    expect(normalizeToolCallContent(body)).toBe(normalizeToolCallBody(body))
  })
})
