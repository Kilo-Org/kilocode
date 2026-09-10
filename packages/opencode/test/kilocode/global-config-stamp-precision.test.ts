import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KilocodeGlobalConfigStamp } from "../../src/kilocode/config/global-stamp"

// Profiles the metadata-only global config stamp on the runner's real filesystem.
// The stamp detects an external config edit by comparing mtimeNs, ctimeNs, size
// and ino. A same-size rewrite inside a single clock tick produces identical
// metadata, so this test measures how often that hides an edit. Coarse timestamp
// clocks (for example the Windows system clock) and low-resolution filesystems
// are the platforms at risk. The JSON artifact lets CI results be compared per OS.
// See https://github.com/Kilo-Org/kilocode for the change that introduced it.

const root = path.resolve(import.meta.dir, "../..")
const trials = 150

type Info = {
  mtime: bigint
  ctime: bigint
  size: bigint
  ino: bigint
}

const statNs = async (file: string): Promise<Info> => {
  const info = await fs.stat(file, { bigint: true })
  return { mtime: info.mtimeNs, ctime: info.ctimeNs, size: info.size, ino: info.ino }
}

describe("global config stamp precision", () => {
  test("detects every same-size rewrite on this platform", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-stamp-precision-"))
    const file = path.join(dir, "kilo.json")
    const allow = JSON.stringify({ permission: { edit: "allow" } })
    const block = JSON.stringify({ permission: { edit: "block" } })
    expect(allow.length).toBe(block.length)

    try {
      await fs.writeFile(file, allow)
      let stamp = await KilocodeGlobalConfigStamp.read(dir)

      let misses = 0
      let sameStamp = 0
      let sameMillisecond = 0
      let minMtimeGapNs = 0n
      let minCtimeGapNs = 0n

      for (let i = 0; i < trials; i++) {
        const before = await statNs(file)
        await fs.writeFile(file, i % 2 === 0 ? block : allow)
        const after = await statNs(file)
        const next = await KilocodeGlobalConfigStamp.read(dir)

        if (next === stamp) {
          misses++
          if (after.mtime === before.mtime && after.ctime === before.ctime) sameStamp++
        }
        if (after.mtime / 1_000_000n === before.mtime / 1_000_000n) sameMillisecond++
        const mtimeGap = after.mtime - before.mtime
        if (mtimeGap > 0n && (minMtimeGapNs === 0n || mtimeGap < minMtimeGapNs)) minMtimeGapNs = mtimeGap
        const ctimeGap = after.ctime - before.ctime
        if (ctimeGap > 0n && (minCtimeGapNs === 0n || ctimeGap < minCtimeGapNs)) minCtimeGapNs = ctimeGap

        stamp = next
      }

      const result = {
        platform: process.platform,
        arch: process.arch,
        bun: Bun.version,
        filesystem: dir,
        trials,
        misses,
        sameStamp,
        sameMillisecond,
        minMtimeGapNs: String(minMtimeGapNs),
        minCtimeGapNs: String(minCtimeGapNs),
      }
      const out = path.join(root, ".artifacts/unit/fs-stamp-precision.json")
      await fs.mkdir(path.dirname(out), { recursive: true })
      await Bun.write(out, JSON.stringify(result, null, 2))
      console.log(`Global config stamp precision (${process.platform}): ${JSON.stringify(result)}`)

      expect(misses, JSON.stringify(result)).toBe(0)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  }, 30_000)
})
