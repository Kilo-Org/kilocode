import { describe, expect, test } from "bun:test"
import { SlackMcp } from "@/kilocode/mcp/slack"

describe("Slack MCP publishing", () => {
  test("appends Kilo attribution to published Slack messages", () => {
    expect(
      SlackMcp.message({
        server: "slack",
        tool: "slack_send_message",
        args: { channel_id: "D123", message: "Hello" },
      }),
    ).toEqual({ channel_id: "D123", message: "Hello\n\nWritten by Kilo" })
  })

  test("does not duplicate an existing attribution", () => {
    expect(
      SlackMcp.message({
        server: "slack",
        tool: "slack_send_message",
        args: { message: "Hello\n\nWritten by Kilo" },
      }),
    ).toEqual({ message: "Hello\n\nWritten by Kilo" })
  })

  test("does not modify drafts or unrelated MCP calls", () => {
    const draft = { message: "Hello" }
    expect(
      SlackMcp.message({
        server: "slack",
        tool: "slack_send_message_draft",
        args: draft,
      }),
    ).toBe(draft)
    expect(SlackMcp.message({ server: "https://example.com/mcp", tool: "slack_send_message", args: draft })).toBe(draft)
  })
})
