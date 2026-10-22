import { beforeEach, describe, expect, it } from "vitest"
import { BRACKETS, BRACKETS_REVERSE, BracketMatchingService } from "./BracketMatchingService"

describe("BracketMatchingService", () => {
  let service: BracketMatchingService

  beforeEach(() => {
    service = new BracketMatchingService()
  })

  it("defines matching bracket pairs", () => {
    expect(BRACKETS).toEqual({ "(": ")", "{": "}", "[": "]" })
    expect(BRACKETS_REVERSE).toEqual({ ")": "(", "}": "{", "]": "[" })
  })

  async function* stream(chunks: string[]): AsyncGenerator<string> {
    for (const chunk of chunks) yield chunk
  }

  async function collect(gen: AsyncGenerator<string>): Promise<string> {
    const chunks: string[] = []
    for await (const chunk of gen) chunks.push(chunk)
    return chunks.join("")
  }

  it("allows a matching single-line closing bracket", async () => {
    const result = service.stopOnUnmatchedClosingBracket(
      stream(["x + 1)"]),
      "const result = calculate(",
      ");",
      "test.ts",
      false,
    )
    expect(await collect(result)).toBe("x + 1)")
  })

  it("stops at an unmatched single-line closing bracket", async () => {
    const result = service.stopOnUnmatchedClosingBracket(
      stream(["x + 1))"]),
      "const result = calculate(",
      "",
      "test.ts",
      false,
    )
    expect(await collect(result)).toBe("x + 1)")
  })

  it("tracks brackets opened by the current stream", async () => {
    const result = service.stopOnUnmatchedClosingBracket(
      stream(["function test() {", "\n  return 1;", "\n}"]),
      "",
      "",
      "test.ts",
      true,
    )
    expect(await collect(result)).toBe("function test() {\n  return 1;\n}")
  })

  it("stops at an unmatched multiline closing bracket", async () => {
    const result = service.stopOnUnmatchedClosingBracket(
      stream(["function test() {\n  return 1;\n}\n}"]),
      "",
      "",
      "test.ts",
      true,
    )
    expect(await collect(result)).toBe("function test() {\n  return 1;\n}\n")
  })

  it("handles nested bracket types", async () => {
    const result = service.stopOnUnmatchedClosingBracket(stream(["arr[i][j]"]), "const val = ", ";", "test.ts", false)
    expect(await collect(result)).toBe("arr[i][j]")
  })

  it("uses closing brackets from a whitespace-prefixed suffix", async () => {
    const result = service.stopOnUnmatchedClosingBracket(stream(["1, 2, 3)"]), "func(", "  )", "test.ts", false)
    expect(await collect(result)).toBe("1, 2, 3)")
  })

  it("stops suffix bracket parsing at other content", async () => {
    const result = service.stopOnUnmatchedClosingBracket(stream(["x)"]), "func(", ") {", "test.ts", false)
    expect(await collect(result)).toBe("x")
  })

  it("handles a closing bracket at a chunk boundary", async () => {
    const result = service.stopOnUnmatchedClosingBracket(
      stream(["return 1", ";", "\n", "}", "extra"]),
      "function test() {",
      "",
      "test.ts",
      true,
    )
    expect(await collect(result)).toBe("return 1;\n")
  })

  it("handles an empty stream", async () => {
    const result = service.stopOnUnmatchedClosingBracket(stream([]), "", "", "test.ts", true)
    expect(await collect(result)).toBe("")
  })
})
