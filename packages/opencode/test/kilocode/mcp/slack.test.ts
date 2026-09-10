import { describe, expect, test } from "bun:test"
import { endpoint, SlackMcp } from "@/kilocode/mcp/slack"

describe("Slack MCP publishing", () => {
  test("appends Kilo attribution to published Slack messages", () => {
    expect(
      SlackMcp.message({
        url: endpoint,
        tool: "slack_send_message",
        args: { channel_id: "D123", message: "Hello" },
      }),
    ).toEqual({ channel_id: "D123", message: "Hello\n\nWritten by Kilo" })
  })

  test("previews the final destination and attributed message without persistent approval", () => {
    const args = SlackMcp.message({
      url: endpoint,
      tool: "slack_send_message",
      args: { channel_id: "C123", message: "Hello world" },
    })

    expect(SlackMcp.permission({ url: endpoint, tool: "slack_send_message", args })).toEqual({
      patterns: ["Post to C123:\n\nHello world\n\nWritten by Kilo"],
      always: [],
      metadata: { disableAlways: true },
    })
  })

  test("previews scheduled messages without persistent approval", () => {
    expect(
      SlackMcp.permission({
        url: endpoint,
        tool: "slack_schedule_message",
        args: { channel_id: "C123", post_at: 1_800_000_000, message: "Hello later" },
      }),
    ).toEqual({
      patterns: ["Schedule for C123 at 1800000000:\n\nHello later"],
      always: [],
      metadata: { disableAlways: true },
    })
  })

  test("previews Slack search queries while allowing tool-level approval", () => {
    expect(
      SlackMcp.permission({
        url: endpoint,
        tool: "slack_search_public",
        args: { query: '"Anaconda MCP" launch after:2026-06-01' },
      }),
    ).toEqual({
      patterns: ['Search Slack for: "Anaconda MCP" launch after:2026-06-01'],
      always: ["*"],
      metadata: {},
    })
  })

  test("preserves generic permission behavior for non-Slack MCP servers", () => {
    expect(
      SlackMcp.permission({ url: "https://api.githubcopilot.com/mcp", tool: "create_issue", args: { title: "Bug" } }),
    ).toEqual({
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })
  })

  test("does not duplicate an existing attribution", () => {
    expect(
      SlackMcp.message({
        url: endpoint,
        tool: "slack_send_message",
        args: { message: "Hello\n\nWritten by Kilo" },
      }),
    ).toEqual({ message: "Hello\n\nWritten by Kilo" })
  })

  test("does not modify drafts or unrelated MCP calls", () => {
    const draft = { message: "Hello" }
    expect(
      SlackMcp.message({
        url: endpoint,
        tool: "slack_send_message_draft",
        args: draft,
      }),
    ).toBe(draft)
    expect(SlackMcp.message({ url: "https://example.com/mcp", tool: "slack_send_message", args: draft })).toBe(draft)
  })

  test("does not apply Slack behavior to a server named slack at another endpoint", () => {
    const args = { channel_id: "C123", message: "Hello" }
    const input = { server: "slack", url: "https://example.com/mcp", tool: "slack_send_message", args }
    expect(SlackMcp.message(input)).toBe(args)
    expect(SlackMcp.permission(input)).toEqual({
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })
  })

  test("applies Slack behavior to the official endpoint under any config key", () => {
    const args = SlackMcp.message({ url: endpoint, tool: "slack_send_message", args: { message: "Hello" } })
    expect(args).toEqual({ message: "Hello\n\nWritten by Kilo" })
    expect(SlackMcp.permission({ url: endpoint, tool: "slack_send_message", args }).always).toEqual([])
  })
})
