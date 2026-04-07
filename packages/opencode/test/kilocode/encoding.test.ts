import { test, expect, describe } from "bun:test"
import { Encoding } from "../../src/kilocode/encoding"
import { tmpdir } from "../fixture/fixture"
import path from "path"
import fs from "fs/promises"

describe("Encoding", () => {
  describe("detect", () => {
    test("detects UTF-8 BOM", () => {
      const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("hello", "utf-8")])
      const info = Encoding.detect(bytes)
      expect(info.encoding).toBe("utf-8")
      expect(info.bom).toBe(true)
    })

    test("detects UTF-16 LE BOM", () => {
      const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("hello", "utf16le")])
      const info = Encoding.detect(bytes)
      expect(info.encoding).toBe("utf-16le")
      expect(info.bom).toBe(true)
    })

    test("detects UTF-16 BE BOM", () => {
      const le = Buffer.from("hello", "utf16le")
      const be = Buffer.allocUnsafe(le.length)
      for (let i = 0; i < le.length - 1; i += 2) {
        be[i] = le[i + 1]
        be[i + 1] = le[i]
      }
      const bytes = Buffer.concat([Buffer.from([0xfe, 0xff]), be])
      const info = Encoding.detect(bytes)
      expect(info.encoding).toBe("utf-16be")
      expect(info.bom).toBe(true)
    })

    test("detects plain UTF-8 (no BOM)", () => {
      const bytes = Buffer.from("hello world", "utf-8")
      const info = Encoding.detect(bytes)
      expect(info.encoding).toBe("utf-8")
      expect(info.bom).toBe(false)
    })

    test("detects Latin-1 for invalid UTF-8 bytes", () => {
      // 0xe9 alone is invalid UTF-8 (incomplete sequence)
      const bytes = Buffer.from([0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x20, 0xe9])
      const info = Encoding.detect(bytes)
      expect(info.encoding).toBe("latin1")
      expect(info.bom).toBe(false)
    })

    test("detects BOM-less UTF-16 LE from null-byte pattern", () => {
      // "AB" in UTF-16LE is: 0x41 0x00 0x42 0x00
      const bytes = Buffer.from("ABCDEFGHIJKLMNOP", "utf16le")
      const info = Encoding.detect(bytes)
      expect(info.encoding).toBe("utf-16le")
      expect(info.bom).toBe(false)
    })

    test("returns utf-8 for empty buffer", () => {
      const info = Encoding.detect(Buffer.alloc(0))
      expect(info.encoding).toBe("utf-8")
      expect(info.bom).toBe(false)
    })
  })

  describe("decode", () => {
    test("decodes UTF-8 with BOM", () => {
      const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("hello", "utf-8")])
      const text = Encoding.decode(bytes, { encoding: "utf-8", bom: true })
      expect(text).toBe("hello")
    })

    test("decodes UTF-8 without BOM", () => {
      const bytes = Buffer.from("hello", "utf-8")
      const text = Encoding.decode(bytes, { encoding: "utf-8", bom: false })
      expect(text).toBe("hello")
    })

    test("decodes UTF-16 LE with BOM", () => {
      const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("hello", "utf16le")])
      const text = Encoding.decode(bytes, { encoding: "utf-16le", bom: true })
      expect(text).toBe("hello")
    })

    test("decodes UTF-16 BE with BOM", () => {
      const le = Buffer.from("hello", "utf16le")
      const be = Buffer.allocUnsafe(le.length)
      for (let i = 0; i < le.length - 1; i += 2) {
        be[i] = le[i + 1]
        be[i + 1] = le[i]
      }
      const bytes = Buffer.concat([Buffer.from([0xfe, 0xff]), be])
      const text = Encoding.decode(bytes, { encoding: "utf-16be", bom: true })
      expect(text).toBe("hello")
    })

    test("decodes Latin-1", () => {
      // "café" in Latin-1: c=0x63, a=0x61, f=0x66, é=0xe9
      const bytes = Buffer.from([0x63, 0x61, 0x66, 0xe9])
      const text = Encoding.decode(bytes, { encoding: "latin1", bom: false })
      expect(text).toBe("caf\u00e9")
    })
  })

  describe("encode", () => {
    test("encodes UTF-8 without BOM", () => {
      const bytes = Encoding.encode("hello", { encoding: "utf-8", bom: false })
      expect(bytes).toEqual(Buffer.from("hello", "utf-8"))
    })

    test("encodes UTF-8 with BOM", () => {
      const bytes = Encoding.encode("hello", { encoding: "utf-8", bom: true })
      expect(bytes[0]).toBe(0xef)
      expect(bytes[1]).toBe(0xbb)
      expect(bytes[2]).toBe(0xbf)
      expect(bytes.subarray(3).toString("utf-8")).toBe("hello")
    })

    test("encodes UTF-16 LE with BOM", () => {
      const bytes = Encoding.encode("hi", { encoding: "utf-16le", bom: true })
      expect(bytes[0]).toBe(0xff)
      expect(bytes[1]).toBe(0xfe)
      expect(bytes.subarray(2).toString("utf16le")).toBe("hi")
    })

    test("encodes UTF-16 BE with BOM", () => {
      const bytes = Encoding.encode("A", { encoding: "utf-16be", bom: true })
      // BOM: FE FF
      expect(bytes[0]).toBe(0xfe)
      expect(bytes[1]).toBe(0xff)
      // 'A' in UTF-16BE: 0x00 0x41
      expect(bytes[2]).toBe(0x00)
      expect(bytes[3]).toBe(0x41)
    })

    test("encodes Latin-1", () => {
      const bytes = Encoding.encode("caf\u00e9", { encoding: "latin1", bom: false })
      expect(bytes).toEqual(Buffer.from([0x63, 0x61, 0x66, 0xe9]))
    })
  })

  describe("round-trip", () => {
    test("UTF-8 with BOM round-trips", () => {
      const original = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("hello world\n", "utf-8")])
      const info = Encoding.detect(original)
      const text = Encoding.decode(original, info)
      const result = Encoding.encode(text, info)
      expect(result).toEqual(original)
    })

    test("UTF-16 LE with BOM round-trips", () => {
      const original = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("hello world\n", "utf16le")])
      const info = Encoding.detect(original)
      const text = Encoding.decode(original, info)
      const result = Encoding.encode(text, info)
      expect(result).toEqual(original)
    })

    test("plain UTF-8 round-trips", () => {
      const original = Buffer.from("hello world\n", "utf-8")
      const info = Encoding.detect(original)
      const text = Encoding.decode(original, info)
      const result = Encoding.encode(text, info)
      expect(result).toEqual(original)
    })

    test("Latin-1 round-trips", () => {
      const original = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]) // "café\n" in latin1
      const info = Encoding.detect(original)
      expect(info.encoding).toBe("latin1")
      const text = Encoding.decode(original, info)
      const result = Encoding.encode(text, info)
      expect(result).toEqual(original)
    })
  })

  describe("file read/write", () => {
    test("preserves UTF-8 BOM through file write/read cycle", async () => {
      await using tmp = await tmpdir()
      const file = path.join(tmp.path, "bom.txt")
      const original = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("line one\nline two\n", "utf-8")])
      await fs.writeFile(file, original)

      const { text, info } = await Encoding.read(file)
      expect(info.encoding).toBe("utf-8")
      expect(info.bom).toBe(true)
      expect(text).toBe("line one\nline two\n")

      // Modify and write back
      const modified = text.replace("one", "1")
      await Encoding.write(file, modified, info)

      // Verify BOM is preserved
      const raw = await fs.readFile(file)
      expect(raw[0]).toBe(0xef)
      expect(raw[1]).toBe(0xbb)
      expect(raw[2]).toBe(0xbf)
      expect(raw.subarray(3).toString("utf-8")).toBe("line 1\nline two\n")
    })

    test("preserves UTF-16 LE BOM through file write/read cycle", async () => {
      await using tmp = await tmpdir()
      const file = path.join(tmp.path, "utf16le.txt")
      const content = "hello world\n"
      const original = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(content, "utf16le")])
      await fs.writeFile(file, original)

      const { text, info } = await Encoding.read(file)
      expect(info.encoding).toBe("utf-16le")
      expect(info.bom).toBe(true)
      expect(text).toBe("hello world\n")

      // Write back unchanged
      await Encoding.write(file, text, info)

      const raw = await fs.readFile(file)
      expect(raw).toEqual(original)
    })

    test("preserves Latin-1 encoding through file write/read cycle", async () => {
      await using tmp = await tmpdir()
      const file = path.join(tmp.path, "latin1.txt")
      // "café résumé\n" in Latin-1
      const original = Buffer.from("caf\xe9 r\xe9sum\xe9\n", "latin1")
      await fs.writeFile(file, original)

      const { text, info } = await Encoding.read(file)
      expect(info.encoding).toBe("latin1")
      expect(text).toContain("caf")
      expect(text).toContain("sum")

      await Encoding.write(file, text, info)

      const raw = await fs.readFile(file)
      expect(raw).toEqual(original)
    })

    test("readSync works for UTF-8 BOM files", async () => {
      await using tmp = await tmpdir()
      const file = path.join(tmp.path, "sync.txt")
      const original = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("sync test", "utf-8")])
      await fs.writeFile(file, original)

      const { text, info } = Encoding.readSync(file)
      expect(info.encoding).toBe("utf-8")
      expect(info.bom).toBe(true)
      expect(text).toBe("sync test")
    })

    test("creates parent directories when writing", async () => {
      await using tmp = await tmpdir()
      const file = path.join(tmp.path, "nested", "dir", "file.txt")

      await Encoding.write(file, "content", Encoding.DEFAULT)

      const raw = await fs.readFile(file, "utf-8")
      expect(raw).toBe("content")
    })
  })
})
