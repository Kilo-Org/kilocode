import { expect, test } from "bun:test"
import { buildPrompt, CLAUDE_CODE_ID, CLAUDE_CODE_RUNTIME, provider } from "../../src/devilcode/claude-code"

test("claude code provider is marked as external agent runtime", () => {
  const data = provider()
  expect(data.id).toBe(CLAUDE_CODE_ID)
  expect(data.models.default.options.runtime).toBe(CLAUDE_CODE_RUNTIME)
  expect(data.models.default.cost.input).toBe(0)
  expect(data.models.default.cost.output).toBe(0)
})

test("buildPrompt serializes transcript content for claude code", () => {
  const text = buildPrompt({
    system: ["Follow the system rules."],
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: "Inspect the repo." }],
      },
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "call_1", toolName: "Read", input: { file_path: "README.md" } },
          { type: "tool-result", toolCallId: "call_1", toolName: "Read", output: { type: "text", value: "hello" } },
        ],
      },
    ],
  })

  expect(text).toContain("Continue this Devil session as Claude Code.")
  expect(text).toContain("Follow the system rules.")
  expect(text).toContain("## User")
  expect(text).toContain("Inspect the repo.")
  expect(text).toContain("[Tool call: Read]")
  expect(text).toContain("[Tool result: Read]")
})
