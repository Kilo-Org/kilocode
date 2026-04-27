// Tests the kilocode-specific patch module guarantees:
// - Files retain their original encoding after an update (UTF-8 BOM, UTF-16,
//   legacy single-byte, CJK).
// - Plain UTF-8 files do not gain a spurious BOM.
// - Moved files keep the original encoding at the new path.
// These round-trip through Patch.applyPatch directly so we exercise the
// encoding + BOM integration in patch/index.ts without the tool stack.

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "os"
import iconv from "iconv-lite"
import { Patch } from "../../src/patch"

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf])
const UTF16_LE_BOM = Buffer.from([0xff, 0xfe])

describe("Patch encoding preservation", () => {
  let dir: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(tmpdir(), "kilo-patch-"))
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  test("preserves UTF-8 BOM through update", async () => {
    const file = path.join(dir, "doc.txt")
    await fs.writeFile(file, Buffer.concat([UTF8_BOM, Buffer.from("line 1\nline 2\n", "utf-8")]))

    const patch = `*** Begin Patch
*** Update File: ${file}
@@
 line 1
-line 2
+line 2 updated
*** End Patch`

    await Patch.applyPatch(patch)

    const bytes = await fs.readFile(file)
    expect(bytes.subarray(0, 3).equals(UTF8_BOM)).toBe(true)
    expect(bytes.subarray(3).toString("utf-8")).toBe("line 1\nline 2 updated\n")
  })

  test("does not introduce BOM for plain UTF-8 files", async () => {
    const file = path.join(dir, "plain.txt")
    await fs.writeFile(file, "line 1\nline 2\n", "utf-8")

    const patch = `*** Begin Patch
*** Update File: ${file}
@@
 line 1
-line 2
+line 2 updated
*** End Patch`

    await Patch.applyPatch(patch)

    const bytes = await fs.readFile(file)
    expect(bytes[0]).not.toBe(0xef)
    expect(bytes.toString("utf-8")).toBe("line 1\nline 2 updated\n")
  })

  test("preserves UTF-16 LE encoding through update", async () => {
    const file = path.join(dir, "utf16.txt")
    await fs.writeFile(file, Buffer.concat([UTF16_LE_BOM, iconv.encode("line 1\nline 2\n", "utf-16le")]))

    const patch = `*** Begin Patch
*** Update File: ${file}
@@
 line 1
-line 2
+line 2 updated
*** End Patch`

    await Patch.applyPatch(patch)

    const bytes = await fs.readFile(file)
    expect(bytes.subarray(0, 2).equals(UTF16_LE_BOM)).toBe(true)
    expect(iconv.decode(bytes.subarray(2), "utf-16le")).toBe("line 1\nline 2 updated\n")
  })

  test("preserves iso-8859-1 encoding through update", async () => {
    const file = path.join(dir, "latin1.txt")
    await fs.writeFile(file, iconv.encode("café\nñandú\n", "iso-8859-1"))

    const patch = `*** Begin Patch
*** Update File: ${file}
@@
 café
-ñandú
+águila
*** End Patch`

    await Patch.applyPatch(patch)

    const bytes = await fs.readFile(file)
    expect(iconv.decode(bytes, "iso-8859-1")).toBe("café\náguila\n")
    // á and ñ are two bytes in UTF-8, one byte in ISO-8859-1. If the file had
    // been silently re-encoded as UTF-8 the byte length would differ.
    expect(bytes.length).toBe("café\náguila\n".length)
  })

  test("preserves Shift_JIS encoding through update", async () => {
    const file = path.join(dir, "jp.txt")
    // jschardet needs enough characteristic bytes to identify Shift_JIS. A
    // single 19-byte phrase looks like windows-1252, so the sample is padded
    // to match the body of Japanese text the tool tests already rely on.
    const sample = "こんにちは、世界！日本語のテストです。"
    await fs.writeFile(file, iconv.encode(`line1\n${sample}\nline3\n`, "Shift_JIS"))

    const patch = `*** Begin Patch
*** Update File: ${file}
@@
 line1
-${sample}
+さようなら、世界！
 line3
*** End Patch`

    await Patch.applyPatch(patch)

    const bytes = await fs.readFile(file)
    expect(iconv.decode(bytes, "Shift_JIS")).toBe("line1\nさようなら、世界！\nline3\n")
    const utf8Rendered = Buffer.from("line1\nさようなら、世界！\nline3\n", "utf-8")
    expect(bytes.equals(utf8Rendered)).toBe(false)
  })

  test("preserves UTF-8 BOM when file is moved", async () => {
    const from = path.join(dir, "old.txt")
    const to = path.join(dir, "new.txt")
    await fs.writeFile(from, Buffer.concat([UTF8_BOM, Buffer.from("original\n", "utf-8")]))

    const patch = `*** Begin Patch
*** Update File: ${from}
*** Move to: ${to}
@@
-original
+updated
*** End Patch`

    await Patch.applyPatch(patch)

    const moved = await fs.readFile(to)
    expect(moved.subarray(0, 3).equals(UTF8_BOM)).toBe(true)
    expect(moved.subarray(3).toString("utf-8")).toBe("updated\n")

    const oldExists = await fs
      .access(from)
      .then(() => true)
      .catch(() => false)
    expect(oldExists).toBe(false)
  })

  test("new files added via patch are written as plain UTF-8", async () => {
    const file = path.join(dir, "new.txt")
    const patch = `*** Begin Patch
*** Add File: ${file}
+hello world
*** End Patch`

    await Patch.applyPatch(patch)

    const bytes = await fs.readFile(file)
    expect(bytes[0]).not.toBe(0xef)
    expect(bytes.toString("utf-8")).toBe("hello world")
  })
})
