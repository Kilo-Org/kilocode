import { describe, it, expect } from "bun:test"
import { extractHttpErrorMessage, parseSSEDataLine } from "../../src/services/cli-backend/http-utils"

describe("extractHttpErrorMessage", () => {
  it("extracts error field from JSON", () => {
    const result = extractHttpErrorMessage("Bad Request", '{"error":"invalid token"}')
    expect(result).toBe("invalid token")
  })

  it("extracts message field from JSON when error is absent", () => {
    const result = extractHttpErrorMessage("Not Found", '{"message":"resource not found"}')
    expect(result).toBe("resource not found")
  })

  it("prefers error over message when both present", () => {
    const result = extractHttpErrorMessage("Bad Request", '{"error":"err","message":"msg"}')
    expect(result).toBe("err")
  })

  it("falls back to statusText when JSON has neither error nor message", () => {
    const result = extractHttpErrorMessage("Bad Request", '{"code":400}')
    expect(result).toBe("Bad Request")
  })

  it("falls back to raw text when JSON parse fails", () => {
    const result = extractHttpErrorMessage("Internal Server Error", "not json at all")
    expect(result).toBe("not json at all")
  })

  it("returns statusText when rawText is empty", () => {
    expect(extractHttpErrorMessage("Unauthorized", "")).toBe("Unauthorized")
  })

  it("returns statusText when rawText is whitespace only", () => {
    expect(extractHttpErrorMessage("Forbidden", "   ")).toBe("Forbidden")
  })

  it("falls back to statusText when error field is falsy empty string", () => {
    const result = extractHttpErrorMessage("Bad Request", '{"error":""}')
    expect(result).toBe("Bad Request")
  })
})

describe("parseSSEDataLine", () => {
  it("returns null for non-data lines", () => {
    expect(parseSSEDataLine("event: message")).toBeNull()
    expect(parseSSEDataLine("id: 123")).toBeNull()
    expect(parseSSEDataLine(": heartbeat")).toBeNull()
    expect(parseSSEDataLine("")).toBeNull()
  })

  it("returns null for [DONE] sentinel", () => {
    expect(parseSSEDataLine("data: [DONE]")).toBeNull()
  })

  it("returns null for malformed JSON", () => {
    expect(parseSSEDataLine("data: {not json}")).toBeNull()
  })

  it("extracts content from choices delta", () => {
    const line = 'data: {"choices":[{"delta":{"content":"hello"}}]}'
    const result = parseSSEDataLine(line)
    expect(result?.content).toBe("hello")
  })

  it("omits content when delta content is empty string", () => {
    const line = 'data: {"choices":[{"delta":{"content":""}}]}'
    const result = parseSSEDataLine(line)
    expect(result?.content).toBeUndefined()
  })

  it("omits content when choices array is empty", () => {
    const line = 'data: {"choices":[]}'
    const result = parseSSEDataLine(line)
    expect(result?.content).toBeUndefined()
  })

  it("extracts usage tokens", () => {
    const line = 'data: {"usage":{"prompt_tokens":10,"completion_tokens":20}}'
    const result = parseSSEDataLine(line)
    expect(result?.inputTokens).toBe(10)
    expect(result?.outputTokens).toBe(20)
  })

  it("defaults token counts to 0 when usage fields are missing", () => {
    const line = 'data: {"usage":{}}'
    const result = parseSSEDataLine(line)
    expect(result?.inputTokens).toBe(0)
    expect(result?.outputTokens).toBe(0)
  })

  it("extracts cost", () => {
    const line = 'data: {"cost":0.0042}'
    const result = parseSSEDataLine(line)
    expect(result?.cost).toBe(0.0042)
  })

  it("extracts all fields in one chunk", () => {
    const line =
      'data: {"choices":[{"delta":{"content":"world"}}],"usage":{"prompt_tokens":5,"completion_tokens":3},"cost":0.001}'
    const result = parseSSEDataLine(line)
    expect(result?.content).toBe("world")
    expect(result?.inputTokens).toBe(5)
    expect(result?.outputTokens).toBe(3)
    expect(result?.cost).toBe(0.001)
  })

  it("returns empty object for valid JSON with no recognized fields", () => {
    const line = 'data: {"id":"abc"}'
    const result = parseSSEDataLine(line)
    expect(result).not.toBeNull()
    expect(result?.content).toBeUndefined()
    expect(result?.cost).toBeUndefined()
  })
})
