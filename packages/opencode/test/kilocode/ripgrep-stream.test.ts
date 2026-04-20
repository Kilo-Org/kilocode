import { describe, expect, test } from "bun:test"
import { RipgrepStream } from "../../src/kilocode/ripgrep-stream"

describe("RipgrepStream", () => {
  test("drains lines without splitting UTF-8 characters", () => {
    const icon = "\u{1f600}"
    const bytes = Buffer.from(`src/${icon}.ts\nnext.ts\n`)
    const decoder = RipgrepStream.decoder()
    const lines: string[] = []

    const first = RipgrepStream.drain(decoder, "", bytes.subarray(0, 5), (line) => lines.push(line))
    const rest = RipgrepStream.drain(decoder, first, bytes.subarray(5), (line) => lines.push(line)) + decoder.end()

    if (rest) lines.push(rest)

    expect(lines).toEqual([`src/${icon}.ts`, "next.ts"])
  })
})
