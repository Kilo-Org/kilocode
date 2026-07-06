import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
import path from "path"
import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js"
import { Agent } from "../../src/agent/agent"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { LSP } from "../../src/lsp/lsp"
import { Instruction } from "../../src/session/instruction"
import { MessageID, SessionID } from "../../src/session/schema"
import { ReadTool } from "../../src/tool/read"
import { Tool } from "../../src/tool/tool"
import { Truncate } from "../../src/tool/truncate"
import { provideInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const ctx: Tool.Context = {
  sessionID: SessionID.make("ses_test-docx"),
  messageID: MessageID.make("msg_test-docx"),
  callID: "",
  agent: "code",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const expanded: Tool.Context = { ...ctx, extra: { includeDirectoryFiles: true } }

const it = testEffect(
  Layer.mergeAll(
    Agent.defaultLayer,
    AppFileSystem.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Instruction.defaultLayer,
    LSP.defaultLayer,
    Truncate.defaultLayer,
  ),
)

const init = Effect.fn("ReadDocxTest.init")(function* () {
  const info = yield* ReadTool
  return yield* Tool.init(info)
})

const run = Effect.fn("ReadDocxTest.run")(function* (
  args: Tool.InferParameters<typeof ReadTool>,
  next: Tool.Context = ctx,
) {
  const tool = yield* init()
  return yield* tool.execute(args, next)
})

const exec = Effect.fn("ReadDocxTest.exec")(function* (
  dir: string,
  args: Tool.InferParameters<typeof ReadTool>,
  next: Tool.Context = ctx,
) {
  return yield* provideInstance(dir)(run(args, next))
})

const fail = Effect.fn("ReadDocxTest.fail")(function* (dir: string, args: Tool.InferParameters<typeof ReadTool>) {
  const exit = yield* exec(dir, args).pipe(Effect.exit)
  if (Exit.isFailure(exit)) {
    const err = Cause.squash(exit.cause)
    return err instanceof Error ? err : new Error(String(err))
  }
  throw new Error("expected read to fail")
})

const put = Effect.fn("ReadDocxTest.put")(function* (filepath: string, content: string | Uint8Array) {
  const fs = yield* AppFileSystem.Service
  yield* fs.writeWithDirs(filepath, content)
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

describe("kilocode DOCX reads", () => {
  it.live("extracts paragraph text from .docx and .DOCX files", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const bytes = yield* Effect.promise(() => document(["First paragraph", "Second paragraph"]))

      for (const ext of ["docx", "DOCX"]) {
        const filepath = path.join(dir, `sample.${ext}`)
        yield* put(filepath, bytes)
        const result = yield* exec(dir, { filePath: filepath })

        expect(result.output).toContain("1: First paragraph")
        expect(result.output).toContain("Second paragraph")
        expect(result.attachments).toBeUndefined()
      }
    }),
  )

  it.live("applies normal read pagination to extracted text", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const filepath = path.join(dir, "paged.docx")
      yield* put(filepath, yield* Effect.promise(() => document(["First paragraph", "Second paragraph"])))

      const result = yield* exec(dir, { filePath: filepath, limit: 1 })

      expect(result.output).toContain("1: First paragraph")
      expect(result.output).not.toContain("Second paragraph")
      expect(result.output).toContain("Use offset=2")
      expect(result.metadata.truncated).toBe(true)
    }),
  )

  it.live("fails clearly for malformed DOCX files", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const filepath = path.join(dir, "invalid.docx")
      yield* put(filepath, new Uint8Array([0x50, 0x4b, 0x03, 0x04]))

      const err = yield* fail(dir, { filePath: filepath })

      expect(err.message).toContain("Failed to extract text from DOCX file")
      expect(err.message).toContain(filepath)
    }),
  )

  it.live("includes extraction warnings for unsupported document elements", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const filepath = path.join(dir, "warning.docx")
      yield* put(filepath, yield* Effect.promise(() => document(["Readable text"], "<w:unsupported/>")))

      const result = yield* exec(dir, { filePath: filepath })

      expect(result.output).toContain("Readable text")
      expect(result.output).toContain("DOCX extraction warnings")
    }),
  )

  it.live("does not expand DOCX content in directory reads", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const folder = path.join(dir, "folder")
      yield* put(path.join(folder, "sample.docx"), yield* Effect.promise(() => document(["Hidden paragraph"])))

      const result = yield* exec(dir, { filePath: folder }, expanded)

      expect(result.output).toContain("sample.docx")
      expect(result.output).not.toContain("Hidden paragraph")
    }),
  )

  it.live("preserves PDF attachments and rejects unsupported binary files", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const pdf = path.join(dir, "sample.pdf")
      const doc = path.join(dir, "sample.doc")
      yield* put(pdf, "%PDF-1.7\nfixture")
      yield* put(doc, new Uint8Array([0x00, 0x01, 0x02]))

      const result = yield* exec(dir, { filePath: pdf })
      const err = yield* fail(dir, { filePath: doc })

      expect(result.output).toBe("PDF read successfully")
      expect(result.attachments?.[0].mime).toBe("application/pdf")
      expect(err.message).toContain("Cannot read binary file")
    }),
  )
})
