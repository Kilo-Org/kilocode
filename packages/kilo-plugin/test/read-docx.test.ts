import { describe, expect } from "bun:test"
import fs from "fs/promises"
import { Effect } from "effect"
import path from "path"
import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js"
import { Environment } from "@opencode/core/environment/index"
import { AbsolutePath } from "@opencode/core/schema"
import { ReadTool } from "@opencode/core/tool/plugin/read"
import { ReadToolFileSystem } from "@opencode/core/tool/read-filesystem"
import { hostEnvironmentLayer } from "../../core/test/fixture/environment"
import { withTempDir } from "../../core/test/fixture/tmpdir"
import { testEffect } from "../../core/test/lib/effect"
import { read } from "../src/read"

const it = testEffect(hostEnvironmentLayer)

const run = (file: string, page: { limit?: number; offset?: number } = {}) =>
  Effect.gen(function* () {
    const environment = yield* Environment.Service
    return yield* read(environment.files, AbsolutePath.make(file), path.basename(file), page)
  })

const document = async (paragraphs: string[], extra = "") => {
  const writer = new ZipWriter(new Uint8ArrayWriter())
  await writer.add(
    "[Content_Types].xml",
    new TextReader(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        "</Types>",
    ),
  )
  await writer.add(
    "_rels/.rels",
    new TextReader(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        "</Relationships>",
    ),
  )
  await writer.add(
    "word/document.xml",
    new TextReader(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
        paragraphs.map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join("") +
        extra +
        "</w:body></w:document>",
    ),
  )
  return writer.close()
}

const text = (
  value: ReadToolFileSystem.FileContent | ReadToolFileSystem.TextPage | ReadToolFileSystem.ListPage,
) => {
  if (value.type !== "text-page") throw new Error(`expected a text page, got ${value.type}`)
  return value
}

describe("kilo DOCX reads", () => {
  it.live("extracts paragraph text from .docx and .DOCX files", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        for (const ext of ["docx", "DOCX"]) {
          const filepath = path.join(tmp.path, `sample.${ext}`)
          yield* Effect.promise(async () => Bun.write(filepath, await document(["First paragraph", "Second paragraph"])))
          const value = text(yield* run(filepath))
          const output = ReadTool.toModelContent(path.basename(filepath), undefined, value)

          expect(output).toContain("1: First paragraph")
          expect(output).toContain("Second paragraph")
        }
      }),
    ),
  )

  it.live("applies normal read pagination to extracted text", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const filepath = path.join(tmp.path, "paged.docx")
        yield* Effect.promise(async () => Bun.write(filepath, await document(["First paragraph", "Second paragraph"])))

        const value = text(yield* run(filepath, { limit: 1 }))
        const output = ReadTool.toModelContent(path.basename(filepath), undefined, value)

        expect(output).toContain("1: First paragraph")
        expect(output).not.toContain("Second paragraph")
        expect(output).toContain("Continue reading with offset: 2")
        expect(value.truncated).toBe(true)
      }),
    ),
  )

  it.live("fails clearly for malformed DOCX files", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const filepath = path.join(tmp.path, "invalid.docx")
        yield* Effect.promise(() => Bun.write(filepath, new Uint8Array([0x50, 0x4b, 0x03, 0x04])))

        const error = yield* run(filepath).pipe(Effect.flip)

        expect(error.message).toContain("Failed to extract text from DOCX file")
        expect(error.message).toContain(filepath)
      }),
    ),
  )

  it.live("includes extraction warnings for unsupported document elements", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const filepath = path.join(tmp.path, "warning.docx")
        yield* Effect.promise(async () => Bun.write(filepath, await document(["Readable text"], "<w:unsupported/>")))

        const value = text(yield* run(filepath))

        expect(value.content).toContain("Readable text")
        expect(value.content).toContain("DOCX extraction warnings")
      }),
    ),
  )

  it.live("lists a directory instead of expanding DOCX content", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const folder = path.join(tmp.path, "folder")
        yield* Effect.promise(() => fs.mkdir(folder))
        yield* Effect.promise(async () => Bun.write(path.join(folder, "sample.docx"), await document(["Hidden paragraph"])))

        const value = yield* run(folder)

        expect(value.type).toBe("list-page")
        expect(ReadTool.toModelContent(folder, undefined, value)).toContain("sample.docx")
        expect(ReadTool.toModelContent(folder, undefined, value)).not.toContain("Hidden paragraph")
      }),
    ),
  )

  it.live("clamps a long extracted line and stops a page at the byte cap", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const line = path.join(tmp.path, "long-line.docx")
        yield* Effect.promise(async () => Bun.write(line, await document(["a".repeat(2_100)])))
        const clamped = text(yield* run(line))

        expect(clamped.content.split("\n")).toEqual([
          "a".repeat(2_000) + "... (line truncated to 2000 chars)",
          "",
        ])

        const many = path.join(tmp.path, "many-lines.docx")
        yield* Effect.promise(async () =>
          Bun.write(many, await document(Array.from({ length: 80 }, () => "b".repeat(1_000)))),
        )
        const capped = text(yield* run(many))

        expect(capped.truncated).toBe(true)
        expect(capped.next).toBeDefined()
        expect(Buffer.byteLength(capped.content, "utf-8")).toBeLessThanOrEqual(ReadToolFileSystem.MAX_READ_BYTES)

        // The last lines returned for an offset past the end keep the same byte cap and end at the last line.
        const tail = text(yield* run(many, { offset: 9_999 }))
        const total = text(yield* run(many, { offset: -1 })).offset
        expect(Buffer.byteLength(tail.content, "utf-8")).toBeLessThanOrEqual(ReadToolFileSystem.MAX_READ_BYTES)
        expect(tail.offset + tail.content.split("\n").length - 1).toBe(total)
        expect(tail.offset).toBeGreaterThan(1)
      }),
    ),
  )

  it.live("returns the last lines for an offset past the end of extracted text", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const filepath = path.join(tmp.path, "short.docx")
        yield* Effect.promise(async () => Bun.write(filepath, await document(["one", "two", "three"])))
        const all = text(yield* run(filepath)).content.split("\n")

        const tail = text(yield* run(filepath, { offset: 50 }))
        expect(tail).toMatchObject({ content: all.join("\n"), offset: 1, truncated: false })
        expect(tail.next).toBeUndefined()
        expect(ReadTool.toModelContent("short.docx", 50, tail)).toContain(
          `(offset 50 is past the end; the file has ${all.length} lines)`,
        )

        const limited = text(yield* run(filepath, { offset: 50, limit: 2 }))
        expect(limited).toMatchObject({ content: all.slice(-2).join("\n"), offset: all.length - 1, truncated: false })
      }),
    ),
  )

  it.live("counts a negative offset back from the last line of extracted text", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const filepath = path.join(tmp.path, "tail.docx")
        yield* Effect.promise(async () => Bun.write(filepath, await document(["one", "two", "three"])))
        const all = text(yield* run(filepath)).content.split("\n")

        const last = text(yield* run(filepath, { offset: -2 }))
        expect(last).toMatchObject({ content: all.slice(-2).join("\n"), offset: all.length - 1, truncated: false })

        const paged = text(yield* run(filepath, { offset: -3, limit: 1 }))
        expect(paged).toMatchObject({
          content: all[all.length - 3],
          offset: all.length - 2,
          truncated: true,
          next: all.length - 1,
        })

        // Counting back past the first line starts at line 1.
        const whole = text(yield* run(filepath, { offset: -500 }))
        expect(whole).toMatchObject({ content: all.join("\n"), offset: 1, truncated: false })
      }),
    ),
  )

  // Creating a symlink needs privileges on Windows.
  const symlinkRead = process.platform === "win32" ? it.live.skip : it.live
  symlinkRead("reads a symlinked document through the target size", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const target = path.join(tmp.path, "target.docx")
        const link = path.join(tmp.path, "link.docx")
        yield* Effect.promise(async () => Bun.write(target, await document(["Linked paragraph"])))
        yield* Effect.promise(() => fs.symlink(target, link))

        const value = text(yield* run(link))

        expect(value.content).toContain("Linked paragraph")
      }),
    ),
  )

  it.live("preserves PDF attachments and rejects unsupported binary files", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const pdf = path.join(tmp.path, "sample.pdf")
        const doc = path.join(tmp.path, "sample.doc")
        yield* Effect.promise(() => Bun.write(pdf, "%PDF-1.7\nfixture"))
        yield* Effect.promise(() => Bun.write(doc, new Uint8Array([0x00, 0x01, 0x02])))

        const value = yield* run(pdf)
        expect(value.type).toBe("file")
        if (value.type === "file") {
          expect(value.mime).toBe("application/pdf")
          expect(value.encoding).toBe("base64")
        }

        const error = yield* run(doc).pipe(Effect.flip)
        expect(error.message).toContain("Cannot read binary file")
      }),
    ),
  )
})
