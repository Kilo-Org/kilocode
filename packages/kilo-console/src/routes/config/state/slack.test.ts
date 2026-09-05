import { describe, expect, test } from "bun:test"
import { slack, slackRedirect, slackScope, slackUrl } from "./slack"

describe("Slack MCP connector", () => {
  test("creates a PKCE-compatible remote configuration without a client secret", () => {
    const cfg = slack(" 123.456 ")

    expect(cfg).toEqual({
      type: "remote",
      url: slackUrl,
      enabled: true,
      timeout: 30_000,
      oauth: {
        clientId: "123.456",
        scope: slackScope,
        redirectUri: slackRedirect,
      },
    })
    expect(cfg.oauth).not.toHaveProperty("clientSecret")
  })

  test("requests DM read and message publishing scopes", () => {
    expect(slackScope).toContain("search:read.im")
    expect(slackScope).toContain("search:read.mpim")
    expect(slackScope).toContain("im:history")
    expect(slackScope).toContain("mpim:history")
    expect(slackScope).toContain("im:read")
    expect(slackScope).toContain("mpim:read")
    expect(slackScope).toContain("im:write")
    expect(slackScope).toContain("mpim:write")
    expect(slackScope).toContain("chat:write")
  })

  test("does not request unrelated write capabilities", () => {
    expect(slackScope).not.toContain("reactions:write")
    expect(slackScope).not.toContain("files:write")
    expect(slackScope).not.toContain("channels:write")
    expect(slackScope).not.toContain("groups:write")
  })
})
