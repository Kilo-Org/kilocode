import { test, expect, describe } from "bun:test"
import { Provider } from "../../../src/provider/provider"
import { formatTable, formatMarkdown, handle, isTextModel } from "../../../src/kilocode/cli/cmd/roll-call"

const base = {
  input: { text: false, audio: false, image: false, video: false, pdf: false },
  output: { text: false, audio: false, image: false, video: false, pdf: false },
}

function caps(opts: { input?: Partial<typeof base.input>; output?: Partial<typeof base.output> }) {
  return {
    capabilities: {
      ...base,
      input: { ...base.input, ...opts.input },
      output: { ...base.output, ...opts.output },
    },
  } as Provider.Model
}

describe("formatTable", () => {
  test("formats simple table correctly", () => {
    const rows = [
      ["kilo/test-model", "YES", "Hello!", "1000ms"],
      ["kilo/another-model", "NO", "(Error)", "500ms"],
    ]
    const result = formatTable(rows, 120)

    expect(result.header).toContain("Model")
    expect(result.header).toContain("Access")
    expect(result.header).toContain("Snippet")
    expect(result.header).toContain("Latency")
    expect(result.separator).toMatch(/^-+$/)
    expect(result.rows).toHaveLength(2)
  })

  test("truncates long snippets", () => {
    const rows = [["model", "YES", "A".repeat(200), "100ms"]]
    const result = formatTable(rows, 80)
    const start = result.rows[0].indexOf("AAA")

    expect(start).toBeGreaterThanOrEqual(0)
  })

  test("strips ANSI codes from cells", () => {
    const rows = [["\x1b[31mmodel\x1b[0m", "YES", "text", "100ms"]]
    const result = formatTable(rows, 120)

    expect(result.rows[0]).not.toContain("\x1b[")
    expect(result.rows[0]).toContain("model")
  })

  test("handles empty rows", () => {
    const result = formatTable([], 120)

    expect(result.rows).toHaveLength(0)
    expect(result.header).toContain("Model")
  })

  test("handles special characters in cells", () => {
    const rows = [
      ["model\nwith\nnewlines", "YES", "text\ttab", "100ms"],
      ["model\r\nwindows", "YES", "text", "100ms"],
    ]
    const result = formatTable(rows, 120)

    expect(result.rows[0]).not.toContain("\n")
    expect(result.rows[0]).not.toContain("\t")
    expect(result.rows[1]).not.toContain("\r")
  })

  test("adjusts column widths for terminal", () => {
    const rows = [["very-long-model-name-here", "YES", "short", "100ms"]]
    const wide = formatTable(rows, 200)
    const narrow = formatTable(rows, 60)

    expect(wide.header.indexOf("Snippet")).toBeGreaterThanOrEqual(0)
    expect(narrow.header.indexOf("Snippet")).toBeGreaterThanOrEqual(0)
  })
})

describe("isTextModel", () => {
  test("accepts text-in text-out model", () => {
    expect(isTextModel(caps({ input: { text: true }, output: { text: true } }))).toBe(true)
  })

  test("accepts multimodal model with text capability", () => {
    expect(isTextModel(caps({ input: { text: true, image: true }, output: { text: true } }))).toBe(true)
  })

  test("rejects audio-in text-out model", () => {
    expect(isTextModel(caps({ input: { audio: true }, output: { text: true } }))).toBe(false)
  })

  test("rejects text-in image-out model", () => {
    expect(isTextModel(caps({ input: { text: true }, output: { image: true } }))).toBe(false)
  })

  test("rejects embedding model", () => {
    expect(isTextModel(caps({ input: { text: true } }))).toBe(false)
  })
})

describe("formatMarkdown", () => {
  test("produces valid markdown table", () => {
    const rows = [
      ["openai/gpt-4o", "YES", "Hello!", "500ms"],
      ["openai/gpt-3.5", "NO", "(timeout)", "25000ms"],
    ]
    const md = formatMarkdown(rows)
    const lines = md.split("\n")

    expect(lines[0]).toMatch(/^\|.*Model.*\|.*Access.*\|.*Snippet.*\|.*Latency.*\|$/)
    expect(lines[1]).toMatch(/^\| -+ \| -+ \| -+ \| -+ \|$/)
    expect(lines).toHaveLength(4)
  })

  test("handles empty rows", () => {
    const md = formatMarkdown([])
    const lines = md.split("\n")

    expect(lines).toHaveLength(2)
  })

  test("escapes pipe characters in cells", () => {
    const rows = [["model", "YES", "hello | world", "100ms"]]
    const md = formatMarkdown(rows)

    expect(md).toContain("hello \\| world")
    expect(md.split("\n")[2].match(/(?<!\\)\|/g)?.length).toBe(5)
  })
})

describe("handle", () => {
  test("does not print progress before markdown output", async () => {
    const logs: string[] = []
    const print = console.log
    const code = process.exitCode

    console.log = (msg?: unknown) => {
      logs.push(String(msg))
    }

    try {
      await handle({
        prompt: "Hello",
        timeout: 1,
        filter: "test",
        parallel: 1,
        output: "md",
        verbose: true,
        quiet: false,
        list: async () => ({}),
      })
    } finally {
      console.log = print
      process.exitCode = code
    }

    expect(logs).toEqual([formatMarkdown([])])
  })
})
