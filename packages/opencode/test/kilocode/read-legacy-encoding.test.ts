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
  test("windows-1251 file is read to its end with the right line count", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kilo-1251-"))
    const file = path.join(dir, "legacy.pas")
    const lines = Array.from({ length: 3000 }, (_, i) => `  // строка ${i + 1}: проверка кодировки windows-1251`)
    fs.writeFileSync(file, Encoding.encode(lines.join("\r\n") + "\r\n", "windows-1251"))
    try {
      for (let i = 0; i < 10; i++) {
        const got = await readLikeTool(file, { offset: 2990, limit: 20 })
        expect(got.count).toBe(3000)
        expect(got.raw).toEqual(lines.slice(2989))
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
