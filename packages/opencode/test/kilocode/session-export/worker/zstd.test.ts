import { describe, test, expect } from "bun:test"
import { compressZstd, decompressZstd } from "@/kilocode/session-export/worker/zstd"

describe("zstd", () => {
  test("roundtrips bytes", async () => {
    const input = Buffer.from("hello world ".repeat(1024))
    const compressed = await compressZstd(input)
    expect(compressed.byteLength).toBeLessThan(input.byteLength)
    const decompressed = await decompressZstd(compressed)
    expect(Buffer.from(decompressed)).toEqual(input)
  })

  test("compresses 1 MB of source-like text under 200 KB", async () => {
    const text = "function foo() { return bar(baz); }\n".repeat(30_000)
    const bytes = Buffer.from(text)
    const compressed = await compressZstd(bytes)
    expect(compressed.byteLength).toBeLessThan(200 * 1024)
  })
})
