// kilocode_change - new file
// Unit tests for the Encoding namespace. These complement tool-encoding.test.ts
// by exercising detect/decode/encode/read/write/readSync directly, without
// going through the Effect runtime, agent harness, or tool pipeline. They are
// cheap, fast, and cover the internal branches (BOM handling, ASCII/UTF-8
// normalization, jschardet fallback, unsupported encoding rejection) that the
// integration tests cannot hit deterministically.

import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import iconv from "iconv-lite"
import { Encoding } from "../../src/kilocode/encoding"

const BOM = {
  utf8: Buffer.from([0xef, 0xbb, 0xbf]),
  utf16le: Buffer.from([0xff, 0xfe]),
  utf16be: Buffer.from([0xfe, 0xff]),
}

async function tmp<T>(body: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-encoding-"))
  try {
    return await body(dir)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

describe("Encoding.detect", () => {
  test("empty buffer falls back to utf-8", () => {
    expect(Encoding.detect(Buffer.alloc(0))).toBe(Encoding.DEFAULT)
  })

  test("plain ASCII is normalized to utf-8 (not 'ascii')", () => {
    // jschardet reports "ascii" for pure-ASCII input; the namespace treats
    // that as UTF-8 because UTF-8 is an ASCII superset and iconv-lite doesn't
    // expose an "ascii" label that round-trips identically.
    expect(Encoding.detect(Buffer.from("plain ascii text\n"))).toBe("utf-8")
  })

  test("valid UTF-8 without BOM detects as utf-8", () => {
    expect(Encoding.detect(Buffer.from("Hello — 世界", "utf-8"))).toBe("utf-8")
  })

  test("UTF-8 with BOM is reported as the distinct utf-8-bom variant", () => {
    const bytes = Buffer.concat([BOM.utf8, Buffer.from("hello", "utf-8")])
    expect(Encoding.detect(bytes)).toBe(Encoding.UTF8_BOM)
  })

  test("BOM-less UTF-8 containing multi-byte chars is not misdetected", () => {
    // Regression guard: bytes that are valid UTF-8 must skip the jschardet
    // branch. jschardet has been known to misfire on short CJK samples.
    expect(Encoding.detect(Buffer.from("한글 テスト 中文", "utf-8"))).toBe("utf-8")
  })

  test("UTF-16 LE with BOM detects as utf-16le", () => {
    const bytes = Buffer.concat([BOM.utf16le, iconv.encode("hello world", "utf-16le")])
    expect(Encoding.detect(bytes)).toBe("utf-16le")
  })

  test("UTF-16 BE with BOM detects as utf-16be", () => {
    const bytes = Buffer.concat([BOM.utf16be, iconv.encode("hello world", "utf-16be")])
    expect(Encoding.detect(bytes)).toBe("utf-16be")
  })

  test("UTF-32 (detected by jschardet) is rejected and falls back to utf-8", () => {
    // Build a sample starting with a UTF-32 LE BOM. jschardet will report
    // UTF-32*; the namespace explicitly strips that because iconv-lite can't
    // round-trip it.
    const bytes = Buffer.concat([Buffer.from([0xff, 0xfe, 0x00, 0x00]), Buffer.alloc(32)])
    expect(Encoding.detect(bytes)).toBe(Encoding.DEFAULT)
  })

  test("Shift_JIS bytes detect as Shift_JIS (case-insensitive, iconv-compatible label)", () => {
    const bytes = iconv.encode("こんにちは、世界！日本語のテストです。", "Shift_JIS")
    const detected = Encoding.detect(bytes)
    expect(detected.toLowerCase()).toBe("shift_jis")
    // The returned label must be accepted by iconv-lite so downstream decode
    // works without a second normalization step.
    expect(iconv.encodingExists(detected)).toBe(true)
  })

  test("Windows-1251 bytes detect as windows-1251", () => {
    const bytes = iconv.encode("Привет, мир! Это тест кириллицы.", "windows-1251")
    expect(Encoding.detect(bytes)).toBe("windows-1251")
  })
})

describe("Encoding.decode / Encoding.encode", () => {
  const cases: Array<[string, string, string]> = [
    ["utf-8", "utf-8", "Hello — £100"],
    ["utf-8-bom synthetic label", Encoding.UTF8_BOM, "hello"],
    ["utf-16le", "utf-16le", "Hello 世界"],
    ["utf-16be", "utf-16be", "Hello 世界"],
    ["Shift_JIS", "Shift_JIS", "日本語"],
    ["windows-1251", "windows-1251", "Привет"],
    ["gb2312", "gb2312", "你好"],
    ["big5", "big5", "繁體"],
    ["euc-kr", "euc-kr", "한국어"],
    ["koi8-r", "koi8-r", "Привет"],
    ["iso-8859-1", "iso-8859-1", "Hëllo Wörld"],
  ]

  for (const [label, encoding, text] of cases) {
    test(`round-trips ${label}`, () => {
      const bytes = Encoding.encode(text, encoding)
      expect(Encoding.decode(bytes, encoding)).toBe(text)
    })
  }

  test("utf-8-bom encode emits exactly one BOM even if input starts with U+FEFF", () => {
    // Regression guard: writers may hand us text that was previously decoded
    // and still carries U+FEFF. The encoder must strip it to avoid doubling.
    const bytes = Encoding.encode("\uFEFFhello", Encoding.UTF8_BOM)
    expect(bytes.subarray(0, 3).equals(BOM.utf8)).toBe(true)
    expect(bytes.subarray(3, 6).equals(BOM.utf8)).toBe(false)
    expect(Encoding.decode(bytes, Encoding.UTF8_BOM)).toBe("hello")
  })

  test("utf-16le encode emits exactly one BOM even if input starts with U+FEFF", () => {
    const bytes = Encoding.encode("\uFEFFhi", "utf-16le")
    expect(bytes.subarray(0, 2).equals(BOM.utf16le)).toBe(true)
    // Next two bytes must be the 'h' code unit (0x68 0x00), not another BOM.
    expect(bytes[2]).toBe(0x68)
    expect(bytes[3]).toBe(0x00)
  })

  test("utf-16be encode emits exactly one BOM even if input starts with U+FEFF", () => {
    const bytes = Encoding.encode("\uFEFFhi", "utf-16be")
    expect(bytes.subarray(0, 2).equals(BOM.utf16be)).toBe(true)
    expect(bytes[2]).toBe(0x00)
    expect(bytes[3]).toBe(0x68)
  })

  test("decode of utf-8-bom produces text without leading U+FEFF", () => {
    // iconv-lite's utf-8 codec is documented to strip BOMs; guard against
    // regressions if the underlying behaviour changes.
    const bytes = Buffer.concat([BOM.utf8, Buffer.from("abc", "utf-8")])
    expect(Encoding.decode(bytes, Encoding.UTF8_BOM)).toBe("abc")
  })
})

describe("Encoding.hasUtf16Bom", () => {
  test("detects LE BOM", () => {
    expect(Encoding.hasUtf16Bom(BOM.utf16le)).toBe(true)
  })
  test("detects BE BOM", () => {
    expect(Encoding.hasUtf16Bom(BOM.utf16be)).toBe(true)
  })
  test("returns false for UTF-8 BOM", () => {
    expect(Encoding.hasUtf16Bom(BOM.utf8)).toBe(false)
  })
  test("returns false for plain ASCII", () => {
    expect(Encoding.hasUtf16Bom(Buffer.from("ab"))).toBe(false)
  })
  test("respects an explicit limit smaller than the buffer", () => {
    // Passing limit<2 must treat the sample as too short to contain a BOM,
    // even if the underlying buffer starts with one. This matches the binary
    // detection call site which reads a bounded sample.
    expect(Encoding.hasUtf16Bom(BOM.utf16le, 1)).toBe(false)
    expect(Encoding.hasUtf16Bom(BOM.utf16le, 2)).toBe(true)
  })
  test("returns false for a one-byte buffer", () => {
    expect(Encoding.hasUtf16Bom(Buffer.from([0xff]))).toBe(false)
  })
})

describe("Encoding.read / Encoding.readSync / Encoding.write", () => {
  test("read detects and decodes Shift_JIS asynchronously", async () => {
    await tmp(async (dir) => {
      const filepath = path.join(dir, "sj.txt")
      const text = "日本語テスト"
      await fs.writeFile(filepath, iconv.encode(text, "Shift_JIS"))
      const result = await Encoding.read(filepath)
      expect(result.text).toBe(text)
      expect(result.encoding.toLowerCase()).toBe("shift_jis")
    })
  })

  test("readSync mirrors read for the same input", async () => {
    await tmp(async (dir) => {
      const filepath = path.join(dir, "sj.txt")
      const text = "日本語テスト"
      await fs.writeFile(filepath, iconv.encode(text, "Shift_JIS"))
      const sync = Encoding.readSync(filepath)
      const async_ = await Encoding.read(filepath)
      expect(sync).toEqual(async_)
    })
  })

  test("read preserves UTF-8 BOM as a distinct encoding label", async () => {
    await tmp(async (dir) => {
      const filepath = path.join(dir, "bom.txt")
      await fs.writeFile(filepath, Buffer.concat([BOM.utf8, Buffer.from("hi", "utf-8")]))
      const result = await Encoding.read(filepath)
      expect(result.encoding).toBe(Encoding.UTF8_BOM)
      expect(result.text).toBe("hi")
    })
  })

  test("write creates missing parent directories", async () => {
    await tmp(async (dir) => {
      const filepath = path.join(dir, "nested", "deeply", "file.txt")
      await Encoding.write(filepath, "hello", "utf-8")
      const bytes = await fs.readFile(filepath)
      expect(bytes.equals(Buffer.from("hello", "utf-8"))).toBe(true)
    })
  })

  test("write defaults to utf-8 when encoding is omitted", async () => {
    await tmp(async (dir) => {
      const filepath = path.join(dir, "default.txt")
      await Encoding.write(filepath, "héllo")
      const bytes = await fs.readFile(filepath)
      expect(bytes.equals(Buffer.from("héllo", "utf-8"))).toBe(true)
    })
  })

  test("write round-trips Shift_JIS bytes exactly", async () => {
    await tmp(async (dir) => {
      const filepath = path.join(dir, "sj.txt")
      const text = "日本語"
      await Encoding.write(filepath, text, "Shift_JIS")
      const bytes = await fs.readFile(filepath)
      expect(bytes.equals(iconv.encode(text, "Shift_JIS"))).toBe(true)
      // Must not be UTF-8 — regression guard against silent promotion.
      expect(bytes.equals(Buffer.from(text, "utf-8"))).toBe(false)
    })
  })

  test("write + read round-trips utf-16le with BOM", async () => {
    await tmp(async (dir) => {
      const filepath = path.join(dir, "u16.txt")
      const text = "Hello 世界"
      await Encoding.write(filepath, text, "utf-16le")
      const bytes = await fs.readFile(filepath)
      expect(bytes.subarray(0, 2).equals(BOM.utf16le)).toBe(true)
      const result = await Encoding.read(filepath)
      expect(result.encoding).toBe("utf-16le")
      expect(result.text).toBe(text)
    })
  })
})
