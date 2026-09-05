import { describe, expect, test } from "bun:test"
import { KilocodeSystemPrompt } from "@/kilocode/system-prompt"

describe("Slack system prompt", () => {
  test("requires a draft or publish choice and attribution for Slack MCP", () => {
    const prompt = KilocodeSystemPrompt.slack({ type: "remote", url: "https://mcp.slack.com/mcp" })

    expect(prompt).toContain("Draft only")
    expect(prompt).toContain("Draft and publish")
    expect(prompt).toContain("Written by Kilo")
    expect(prompt).toContain("direct messages")
  })

  test("does not affect unrelated MCP servers", () => {
    expect(KilocodeSystemPrompt.slack({ type: "remote", url: "https://example.com/mcp" })).toBeUndefined()
    expect(KilocodeSystemPrompt.slack(undefined)).toBeUndefined()
  })
})
