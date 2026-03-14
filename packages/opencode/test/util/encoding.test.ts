import { describe, test, expect } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import {
  readWithEncoding,
  readWithEncodingSync,
  encodeWithEncoding,
  DEFAULT_ENCODING,
  type FileEncoding,
} from "../../src/util/encoding"

describe("encoding", () => {
  describe("readWithEncoding", () => {
    test("reads plain UTF-8 file", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "plain.txt")
      await fs.writeFile(filepath, "hello world\n", "utf-8")

      const { text, fileEncoding } = await readWithEncoding(filepath)
      expect(text).toBe("hello world\n")
      expect(fileEncoding.encoding).toBe("utf-8")
      expect(fileEncoding.bom).toBe(false)
      expect(fileEncoding.lineEnding).toBe("lf")
    })

    test("reads UTF-8 with BOM", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "bom.txt")
      const bom = Buffer.from([0xef, 0xbb, 0xbf])
      const content = Buffer.from("hello BOM\n", "utf-8")
      await fs.writeFile(filepath, Buffer.concat([bom, content]))

      const { text, fileEncoding } = await readWithEncoding(filepath)
      expect(text).toBe("hello BOM\n")
      expect(fileEncoding.encoding).toBe("utf-8")
      expect(fileEncoding.bom).toBe(true)
      expect(fileEncoding.lineEnding).toBe("lf")
    })

    test("reads UTF-16LE with BOM", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "utf16le.txt")
      const bom = Buffer.from([0xff, 0xfe])
      const content = Buffer.from("hi\n", "utf16le")
      await fs.writeFile(filepath, Buffer.concat([bom, content]))

      const { text, fileEncoding } = await readWithEncoding(filepath)
      expect(text).toBe("hi\n")
      expect(fileEncoding.encoding).toBe("utf16le")
      expect(fileEncoding.bom).toBe(true)
    })

    test("detects CRLF line endings", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "crlf.txt")
      await fs.writeFile(filepath, "line1\r\nline2\r\nline3\r\n", "utf-8")

      const { text, fileEncoding } = await readWithEncoding(filepath)
      expect(text).toBe("line1\r\nline2\r\nline3\r\n")
      expect(fileEncoding.lineEnding).toBe("crlf")
    })

    test("detects LF line endings", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "lf.txt")
      await fs.writeFile(filepath, "line1\nline2\nline3\n", "utf-8")

      const { text, fileEncoding } = await readWithEncoding(filepath)
      expect(text).toBe("line1\nline2\nline3\n")
      expect(fileEncoding.lineEnding).toBe("lf")
    })

    test("detects mixed line endings", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "mixed.txt")
      await fs.writeFile(filepath, "line1\r\nline2\nline3\r\n", "utf-8")

      const { text, fileEncoding } = await readWithEncoding(filepath)
      expect(text).toBe("line1\r\nline2\nline3\r\n")
      expect(fileEncoding.lineEnding).toBe("mixed")
    })

    test("handles empty file", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "empty.txt")
      await fs.writeFile(filepath, "")

      const { text, fileEncoding } = await readWithEncoding(filepath)
      expect(text).toBe("")
      expect(fileEncoding.encoding).toBe("utf-8")
      expect(fileEncoding.bom).toBe(false)
      expect(fileEncoding.lineEnding).toBe("lf")
    })

    test("reads file with non-ASCII UTF-8 characters", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "unicode.txt")
      await fs.writeFile(filepath, "こんにちは世界\nПривет мир\n", "utf-8")

      const { text, fileEncoding } = await readWithEncoding(filepath)
      expect(text).toBe("こんにちは世界\nПривет мир\n")
      expect(fileEncoding.encoding).toBe("utf-8")
      expect(fileEncoding.bom).toBe(false)
    })
  })

  describe("readWithEncodingSync", () => {
    test("reads plain UTF-8 file synchronously", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "sync.txt")
      await fs.writeFile(filepath, "sync content\n", "utf-8")

      const { text, fileEncoding } = readWithEncodingSync(filepath)
      expect(text).toBe("sync content\n")
      expect(fileEncoding.encoding).toBe("utf-8")
      expect(fileEncoding.bom).toBe(false)
    })

    test("reads UTF-8 with BOM synchronously", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "sync-bom.txt")
      const bom = Buffer.from([0xef, 0xbb, 0xbf])
      const content = Buffer.from("BOM content\n", "utf-8")
      await fs.writeFile(filepath, Buffer.concat([bom, content]))

      const { text, fileEncoding } = readWithEncodingSync(filepath)
      expect(text).toBe("BOM content\n")
      expect(fileEncoding.bom).toBe(true)
    })
  })

  describe("encodeWithEncoding", () => {
    test("encodes plain UTF-8 without BOM", () => {
      const result = encodeWithEncoding("hello\n", DEFAULT_ENCODING)
      expect(result.toString("utf-8")).toBe("hello\n")
      // No BOM bytes
      expect(result[0]).not.toBe(0xef)
    })

    test("encodes UTF-8 with BOM", () => {
      const encoding: FileEncoding = { encoding: "utf-8", bom: true, lineEnding: "lf" }
      const result = encodeWithEncoding("hello\n", encoding)
      // Check BOM bytes
      expect(result[0]).toBe(0xef)
      expect(result[1]).toBe(0xbb)
      expect(result[2]).toBe(0xbf)
      // Check content after BOM
      expect(result.subarray(3).toString("utf-8")).toBe("hello\n")
    })

    test("encodes with CRLF line endings", () => {
      const encoding: FileEncoding = { encoding: "utf-8", bom: false, lineEnding: "crlf" }
      const result = encodeWithEncoding("line1\nline2\n", encoding)
      expect(result.toString("utf-8")).toBe("line1\r\nline2\r\n")
    })

    test("normalizes CRLF before applying target line endings", () => {
      const encoding: FileEncoding = { encoding: "utf-8", bom: false, lineEnding: "crlf" }
      // Input already has CRLF - should not double-convert
      const result = encodeWithEncoding("line1\r\nline2\r\n", encoding)
      expect(result.toString("utf-8")).toBe("line1\r\nline2\r\n")
    })

    test("encodes UTF-16LE with BOM", () => {
      const encoding: FileEncoding = { encoding: "utf16le", bom: true, lineEnding: "lf" }
      const result = encodeWithEncoding("hi\n", encoding)
      // Check UTF-16LE BOM
      expect(result[0]).toBe(0xff)
      expect(result[1]).toBe(0xfe)
      // Check content is UTF-16LE encoded
      const text = result.subarray(2).toString("utf16le")
      expect(text).toBe("hi\n")
    })
  })

  describe("round-trip preservation", () => {
    test("preserves UTF-8 BOM through read-modify-write cycle", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "roundtrip-bom.txt")

      // Write a file with BOM
      const bom = Buffer.from([0xef, 0xbb, 0xbf])
      const original = Buffer.from("original content\n", "utf-8")
      await fs.writeFile(filepath, Buffer.concat([bom, original]))

      // Read with encoding detection
      const { text, fileEncoding } = await readWithEncoding(filepath)
      expect(fileEncoding.bom).toBe(true)

      // Modify content
      const modified = text.replace("original", "modified")

      // Write back with same encoding
      const encoded = encodeWithEncoding(modified, fileEncoding)
      await fs.writeFile(filepath, encoded)

      // Verify BOM is preserved
      const rawBytes = await fs.readFile(filepath)
      expect(rawBytes[0]).toBe(0xef)
      expect(rawBytes[1]).toBe(0xbb)
      expect(rawBytes[2]).toBe(0xbf)
      expect(rawBytes.subarray(3).toString("utf-8")).toBe("modified content\n")
    })

    test("preserves CRLF line endings through read-modify-write cycle", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "roundtrip-crlf.txt")

      // Write a file with CRLF
      await fs.writeFile(filepath, "line1\r\nline2\r\nline3\r\n", "utf-8")

      // Read with encoding detection
      const { text, fileEncoding } = await readWithEncoding(filepath)
      expect(fileEncoding.lineEnding).toBe("crlf")

      // Modify content (adding a line with LF - the encoder should normalize to CRLF)
      const modified = text.replace("line2", "modified")

      // Write back with same encoding
      const encoded = encodeWithEncoding(modified, fileEncoding)
      await fs.writeFile(filepath, encoded)

      // Verify CRLF is preserved
      const result = await fs.readFile(filepath, "utf-8")
      expect(result).toBe("line1\r\nmodified\r\nline3\r\n")
    })

    test("preserves plain UTF-8 without adding BOM", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "roundtrip-plain.txt")

      // Write plain UTF-8
      await fs.writeFile(filepath, "plain content\n", "utf-8")

      // Read with encoding detection
      const { text, fileEncoding } = await readWithEncoding(filepath)
      expect(fileEncoding.bom).toBe(false)

      // Write back
      const encoded = encodeWithEncoding(text, fileEncoding)
      await fs.writeFile(filepath, encoded)

      // Verify no BOM was added
      const rawBytes = await fs.readFile(filepath)
      expect(rawBytes[0]).not.toBe(0xef)
      expect(rawBytes.toString("utf-8")).toBe("plain content\n")
    })

    test("preserves UTF-8 BOM + CRLF together", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "roundtrip-bom-crlf.txt")

      // Write BOM + CRLF file
      const bom = Buffer.from([0xef, 0xbb, 0xbf])
      const content = Buffer.from("line1\r\nline2\r\n", "utf-8")
      await fs.writeFile(filepath, Buffer.concat([bom, content]))

      // Read
      const { text, fileEncoding } = await readWithEncoding(filepath)
      expect(fileEncoding.bom).toBe(true)
      expect(fileEncoding.lineEnding).toBe("crlf")

      // Modify
      const modified = text.replace("line1", "updated")

      // Write back
      const encoded = encodeWithEncoding(modified, fileEncoding)
      await fs.writeFile(filepath, encoded)

      // Verify both BOM and CRLF preserved
      const rawBytes = await fs.readFile(filepath)
      expect(rawBytes[0]).toBe(0xef)
      expect(rawBytes[1]).toBe(0xbb)
      expect(rawBytes[2]).toBe(0xbf)
      expect(rawBytes.subarray(3).toString("utf-8")).toBe("updated\r\nline2\r\n")
    })
  })
})
