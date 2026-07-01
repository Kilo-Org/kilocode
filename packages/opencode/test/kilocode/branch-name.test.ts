import { describe, expect, test } from "bun:test"
import { messages, parse } from "../../src/kilocode/branch-name"
import { MessageV2 } from "../../src/session/message-v2"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { MessageID, PartID, SessionID } from "../../src/session/schema"

function user(text: string, synthetic = false): MessageV2.WithParts {
  const sessionID = SessionID.make("ses_branch_name_test")
  const messageID = MessageID.ascending()
  return {
    info: {
      id: messageID,
      sessionID,
      role: "user",
      time: { created: Date.now() },
      agent: "code",
      model: {
        providerID: ProviderID.make("kilo"),
        modelID: ModelID.make("kilo-auto/small"),
      },
    },
    parts: [
      {
        id: PartID.ascending(),
        sessionID,
        messageID,
        type: "text",
        text,
        synthetic,
      },
    ],
  }
}

describe("branch name generation helpers", () => {
  test("sanitizes model output into a safe branch segment", () => {
    expect(parse("fix-token-refresh-race")).toBe("fix-token-refresh-race")
    expect(parse("Fix OAuth / Token Refresh!")).toBe("fix-oauth-token-refresh")
    expect(parse("feature")).toBe("feature")
    expect(parse("null")).toBeNull()
    expect(parse("!!!")).toBeNull()
  })

  test("removes reasoning wrappers before parsing", () => {
    expect(parse("<think>Choose a durable outcome</think>\nadd-health-check-endpoint")).toBe(
      "add-health-check-endpoint",
    )
    expect(parse("<THINK>Choose a durable outcome</THINK>\nadd-health-check-endpoint")).toBe(
      "add-health-check-endpoint",
    )
  })

  test("uses recent real user messages and appends the pending prompt once", () => {
    const history = [user("hi"), user("internal", true), user("Can you inspect auth?")]
    expect(messages(history, "Fix the token refresh race")).toEqual([
      "hi",
      "Can you inspect auth?",
      "Fix the token refresh race",
    ])
    expect(messages([...history, user("Fix the token refresh race")], "Fix the token refresh race")).toEqual([
      "hi",
      "Can you inspect auth?",
      "Fix the token refresh race",
    ])
    expect(messages([...history, user("Fix   the token refresh race")], "Fix the token refresh race")).toEqual([
      "hi",
      "Can you inspect auth?",
      "Fix   the token refresh race",
    ])
  })

  test("keeps only the latest four user messages", () => {
    const history = [user("one"), user("two"), user("three"), user("four"), user("five")]
    expect(messages(history, "six")).toEqual(["three", "four", "five", "six"])
  })

  test("truncates large messages before generation", () => {
    const big = "x".repeat(2_000)

    expect(messages([user(big)], big)).toEqual(["x".repeat(1_000)])
  })
})
