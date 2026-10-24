import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import fs from "fs"
import os from "os"
import path from "path"
import { createInterface } from "readline"
import type { Readable } from "stream"
import * as Encoding from "../../src/kilocode/encoding"
import * as TextStream from "../../src/kilocode/text-stream"
import { KiloReadObject } from "../../src/kilocode/tool/read-object"

// The same pipeline as the read tool uses for ordinary text (tool/read.ts `lines` + `collect`): the real file object,
// the optimistic UTF-8 stream with the legacy-encoding fallback, and readline collection to the end of the file.
async function collect(stream: Readable, opts: { limit: number; offset: number }) {
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  const raw: string[] = []
  let count = 0
  try {
    for await (const text of rl) {
      count += 1
      if (count < opts.offset || raw.length >= opts.limit) continue
      raw.push(text)
    }
  } finally {
    rl.close()
    stream.destroy()
  }
  return { raw, count }
}

function readLikeTool(file: string, opts: { limit: number; offset: number }) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const info = yield* KiloReadObject.file(file)
      return yield* KiloReadObject.use(info, (obj) =>
        Effect.tryPromise({
          try: (signal) =>
            TextStream.withFallback(
              () => obj.stream(signal),
              (next) => obj.read(undefined, next),
              (stream) => collect(stream, opts),
              signal,
            ),
          catch: (err) => (err instanceof Error ? err : new Error(String(err))),
        }),
      )
    }),
  )
}

describe("read of legacy-encoded files", () => {
  // Read the last lines of a generated windows-1251 file of `total` lines, 10 times.
  async function readTail(total: number, line: (i: number) => string) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kilo-1251-"))
    const file = path.join(dir, "legacy.pas")
    const lines = Array.from({ length: total }, (_, i) => line(i + 1))
    fs.writeFileSync(file, Encoding.encode(lines.join("\r\n") + "\r\n", "windows-1251"))
    try {
      for (let i = 0; i < 10; i++) {
        const got = await readLikeTool(file, { offset: total - 10, limit: 20 })
        expect(got.count).toBe(total)
        expect(got.raw).toEqual(lines.slice(total - 11))
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }

  // ~147 KB of decoded text: several 64 KB slices
  test("windows-1251 file larger than one slice is read to its end with the right line count", () =>
    readTail(3000, (i) => `  // строка ${i}: проверка кодировки windows-1251`), 60_000)

  // ~36 KB of decoded text: a single slice. The old failure depends on the number of lines in one synchronous chunk,
  // not on its size (Bun's readline read up to 1025 lines of one chunk, 1026+ failed), so the small file has 2000 lines.
  test("windows-1251 file smaller than one slice with many lines is read to its end", () =>
    readTail(2000, (i) => `строка ${i}`), 60_000)
})
