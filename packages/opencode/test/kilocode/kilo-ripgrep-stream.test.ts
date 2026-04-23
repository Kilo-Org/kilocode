import { describe, expect, test } from "bun:test"
import { KiloRipgrepStream } from "../../src/kilocode/kilo-ripgrep-stream"

describe("KiloRipgrepStream", () => {
  test("drains lines without splitting UTF-8 characters", () => {
    const icon = "\u{1f600}"
    const bytes = Buffer.from(`src/${icon}.ts\nnext.ts\n`)
    const decoder = KiloRipgrepStream.decoder()
    const lines: string[] = []

    const first = KiloRipgrepStream.drain(decoder, "", bytes.subarray(0, 5), (line) => lines.push(line))
    const rest = KiloRipgrepStream.drain(decoder, first, bytes.subarray(5), (line) => lines.push(line)) + decoder.end()

    if (rest) lines.push(rest)

    expect(lines).toEqual([`src/${icon}.ts`, "next.ts"])
  })
})
