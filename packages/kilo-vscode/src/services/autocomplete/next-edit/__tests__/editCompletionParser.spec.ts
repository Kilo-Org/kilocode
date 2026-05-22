import { parseMercuryEditReply } from "../editCompletionParser"

describe("parseMercuryEditReply", () => {
  it("extracts the fenced body when the model returns plain triple backticks", () => {
    const reply = "Some preamble\n```\nfunction foo() {\n  return 1\n}\n```\n"
    expect(parseMercuryEditReply(reply)).toBe("function foo() {\n  return 1\n}")
  })

  it("extracts the body when the fence has a language tag", () => {
    const reply = "```typescript\nconst x = 1\n```"
    expect(parseMercuryEditReply(reply)).toBe("const x = 1")
  })

  it("strips Mercury <|code_to_edit|> sentinels when the model includes them", () => {
    const reply = "```\n<|code_to_edit|>\nconst x = 2\n<|/code_to_edit|>\n```"
    expect(parseMercuryEditReply(reply)).toBe("const x = 2")
  })

  it("returns null when no fenced block is present", () => {
    expect(parseMercuryEditReply("just text, no fence")).toBeNull()
  })

  it("returns null on an empty string", () => {
    expect(parseMercuryEditReply("")).toBeNull()
  })
})
