import { Cause, Effect, Exit, Layer } from "effect"
import { describe, expect } from "bun:test"
import { truncate } from "fs/promises"
import path from "path"
import { write, utils, type WorkBook, type WorkSheet } from "xlsx"
import { TextReader, TextWriter, Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter } from "@zip.js/zip.js"
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

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  callID: "",
  agent: "code",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

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

const run = Effect.fn("XlsxReadTest.run")(function* (
  dir: string,
  file: string,
  opts: { limit?: number; offset?: number } = {},
) {
  const info = yield* ReadTool
  const tool = yield* Tool.init(info)
  return yield* provideInstance(dir)(tool.execute({ filePath: file, ...opts }, ctx))
})

const fail = Effect.fn("XlsxReadTest.fail")(function* (dir: string, file: string) {
  const exit = yield* run(dir, file).pipe(Effect.exit)
  if (Exit.isFailure(exit)) {
    const err = Cause.squash(exit.cause)
    return err instanceof Error ? err : new Error(String(err))
  }
  throw new Error("expected read to fail")
})

const put = Effect.fn("XlsxReadTest.put")(function* (file: string, bytes: Uint8Array | string) {
  const fs = yield* AppFileSystem.Service
  yield* fs.writeWithDirs(file, bytes)
})

function bytes(book: WorkBook) {
  return new Uint8Array(write(book, { bookType: "xlsx", type: "buffer" }) as Uint8Array)
}

function bytesODS(book: WorkBook) {
  return new Uint8Array(write(book, { bookType: "ods", type: "buffer" }) as Uint8Array)
}

function fixture(name: string) {
  return Bun.file(path.join(import.meta.dir, "../fixture/spreadsheet", name)).bytes()
}

async function range(bytes: Uint8Array) {
  const reader = new ZipReader(new Uint8ArrayReader(bytes))
  const output = new ZipWriter(new Uint8ArrayWriter())
  for (const entry of await reader.getEntries()) {
    if (entry.directory) {
      await output.add(entry.filename)
      continue
    }
    if (entry.filename === "xl/worksheets/sheet1.xml") {
      const xml = await entry.getData!(new TextWriter())
      const sheet = xml
        .replace(/ref="A1"/, 'ref="A1:XFD50001"')
        .replace("</sheetData>", '<row r="50001"><c r="A50001" t="str"><v>last</v></c></row></sheetData>')
      await output.add(entry.filename, new TextReader(sheet))
      continue
    }
    await output.add(entry.filename, new Uint8ArrayReader(await entry.getData!(new Uint8ArrayWriter())))
  }
  await reader.close()
  return output.close()
}

function book(sheet: WorkSheet, name = "Visible") {
  const value = utils.book_new()
  utils.book_append_sheet(value, sheet, name)
  return value
}

describe("kilocode XLSX reads", () => {
  it.live("extracts labelled formatted content from case-variant XLSX files", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const sheet: WorkSheet = {
        A1: { t: "s", v: "Link", l: { Target: "https://kilo.ai" } },
        B1: { t: "d", v: new Date("2026-05-29T00:00:00.000Z") },
        C1: { t: "n", v: 42, f: "SUM(40,2)" },
        D1: { t: "e", v: 0x07, w: "#DIV/0!" },
        C2: { t: "n", f: "SUM(C1:C1)" },
        A4: { t: "s", v: "After blank row" },
        "!ref": "A1:D4",
      }
      const file = path.join(dir, "report.XLSX")
      yield* put(file, bytes(book(sheet)))

      const result = yield* run(dir, file)

      expect(result.output).toContain("--- Sheet: Visible ---")
      expect(result.output).toContain("Link (https://kilo.ai)")
      expect(result.output).toContain("2026-05-29")
      expect(result.output).toContain("42")
      expect(result.output).toContain("[Formula: SUM(C1:C1)]")
      expect(result.output).toContain("[Error: #DIV/0!]")
      expect(result.output).toContain("After blank row")
      expect(result.attachments).toBeUndefined()
    }),
  )

  it.live("omits hidden and very-hidden worksheets", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const value = book(utils.aoa_to_sheet([["Visible content"]]))
      utils.book_append_sheet(value, utils.aoa_to_sheet([["Hidden content"]]), "Hidden")
      utils.book_append_sheet(value, utils.aoa_to_sheet([["Secret content"]]), "Secret")
      value.Workbook = { Sheets: [{ Hidden: 0 }, { Hidden: 1 }, { Hidden: 2 }] }
      const file = path.join(dir, "sheets.xlsx")
      yield* put(file, bytes(value))

      const result = yield* run(dir, file)

      expect(result.output).toContain("Visible content")
      expect(result.output).not.toContain("Hidden content")
      expect(result.output).not.toContain("Secret content")
    }),
  )

  it.live("caps worksheet extraction rows before ordinary read limits", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const sheet = utils.aoa_to_sheet(Array.from({ length: 50_001 }, (_, row) => [`row-${row + 1}`]))
      const file = path.join(dir, "large.xlsx")
      yield* put(file, bytes(book(sheet)))

      const result = yield* run(dir, file, { offset: 49_999, limit: 4 })

      expect(result.output).toContain("row-50000")
      expect(result.output).not.toContain("row-50001")
      expect(result.output).toContain("[... truncated at row 50000 ...]")
    }),
  )

  it.live("applies ordinary read line limits to spreadsheet text", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const file = path.join(dir, "limited.xlsx")
      yield* put(file, bytes(book(utils.aoa_to_sheet([["one"], ["two"], ["three"]]))))

      const result = yield* run(dir, file, { limit: 2 })

      expect(result.metadata.truncated).toBe(true)
      expect(result.output).toContain("1: --- Sheet: Visible ---")
      expect(result.output).toContain("2: one")
      expect(result.output).not.toContain("3: two")
    }),
  )

  it.live("does not traverse every blank cell in a sparse wide range", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const file = path.join(dir, "sparse.xlsx")
      const source = bytes(book(utils.aoa_to_sheet([["first"]])))
      yield* put(file, yield* Effect.promise(() => range(source)))

      const result = yield* run(dir, file)

      expect(result.output).toContain("--- Sheet: Visible ---")
      expect(result.output).toContain("first")
      expect(result.output).toContain("[... truncated at row 50000 ...]")
    }),
  )

  it.live("fails clearly for invalid spreadsheet input", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const file = path.join(dir, "invalid.xlsx")
      yield* put(file, "not an xlsx workbook")

      const err = yield* fail(dir, file)

      expect(err.message).toContain("Cannot read spreadsheet file")
      expect(err.message).toContain("not a valid spreadsheet")
    }),
  )

  it.live("rejects spreadsheets larger than the parser input limit", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const file = path.join(dir, "large-input.xlsx")
      yield* put(file, new Uint8Array([0x50, 0x4b]))
      yield* Effect.promise(() => truncate(file, 50 * 1024 * 1024 + 1))

      const err = yield* fail(dir, file)

      expect(err.message).toContain("Cannot read spreadsheet file")
      expect(err.message).toContain("exceeds the 50 MB size limit")
    }),
  )

  it.live("continues rejecting unsupported workbook formats as binary", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const file = path.join(dir, "legacy.xls")
      yield* put(file, bytes(book(utils.aoa_to_sheet([["ignored"]]))))

      const err = yield* fail(dir, file)

      expect(err.message).toContain("Cannot read binary file")
    }),
  )

  it.live("continues returning PDF files as native attachments", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const file = path.join(dir, "native.pdf")
      yield* put(file, "%PDF-1.7\n")

      const result = yield* run(dir, file)

      expect(result.output).toBe("PDF read successfully")
      expect(result.attachments?.[0].mime).toBe("application/pdf")
    }),
  )
})

describe("kilocode ODS reads", () => {
  it.live("extracts labelled formatted content from case-variant ODS files", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const sheet: WorkSheet = {
        A1: { t: "s", v: "Link", l: { Target: "https://kilo.ai" } },
        B1: { t: "d", v: new Date("2026-05-29T00:00:00.000Z") },
        C1: { t: "n", v: 42 },
        A4: { t: "s", v: "After blank row" },
        "!ref": "A1:C4",
      }
      const file = path.join(dir, "report.ODS")
      yield* put(file, bytesODS(book(sheet)))

      const result = yield* run(dir, file)

      expect(result.output).toContain("--- Sheet: Visible ---")
      expect(result.output).toContain("Link (https://kilo.ai)")
      expect(result.output).toContain("2026-05-29")
      expect(result.output).toContain("42")
      expect(result.output).toContain("After blank row")
      expect(result.attachments).toBeUndefined()
    }),
  )

  it.live("extracts content from all sheets in ODS files", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const value = book(utils.aoa_to_sheet([["Visible content"]]))
      utils.book_append_sheet(value, utils.aoa_to_sheet([["Other content"]]), "Other")
      const file = path.join(dir, "sheets.ods")
      yield* put(file, bytesODS(value))

      const result = yield* run(dir, file)

      expect(result.output).toContain("Visible content")
      expect(result.output).toContain("Other content")
    }),
  )

  it.live("extracts repeated non-empty cells from OpenOffice ODS files", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const file = path.join(dir, "repeated-cells.ods")
      yield* put(file, yield* Effect.promise(() => fixture("repeated-cells.ods")))

      const result = yield* run(dir, file)

      expect(result.output).toContain("--- Sheet: Sheet1 ---")
      expect(result.output).toContain("1\t1")
    }),
  )

  it.live("omits style-hidden worksheets from LibreOffice ODS files", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const file = path.join(dir, "hidden-sheet.ods")
      yield* put(file, yield* Effect.promise(() => fixture("hidden-sheet.ods")))

      const result = yield* run(dir, file)

      expect(result.output).toContain("--- Sheet: Ranges ---")
      expect(result.output).not.toContain("--- Sheet: Sheet1 ---")
      expect(result.output).not.toContain("Invisible")
    }),
  )

  it.live("caps worksheet extraction rows before ordinary read limits in ODS files", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const sheet = utils.aoa_to_sheet(Array.from({ length: 50_001 }, (_, row) => [`row-${row + 1}`]))
      const file = path.join(dir, "large.ods")
      yield* put(file, bytesODS(book(sheet)))

      const result = yield* run(dir, file, { offset: 49_999, limit: 4 })

      expect(result.output).toContain("row-50000")
      expect(result.output).not.toContain("row-50001")
      expect(result.output).toContain("[... truncated at row 50000 ...]")
    }),
  )

  it.live("applies ordinary read line limits to spreadsheet text in ODS files", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const file = path.join(dir, "limited.ods")
      yield* put(file, bytesODS(book(utils.aoa_to_sheet([["one"], ["two"], ["three"]]))))

      const result = yield* run(dir, file, { limit: 2 })

      expect(result.metadata.truncated).toBe(true)
      expect(result.output).toContain("1: --- Sheet: Visible ---")
      expect(result.output).toContain("2: one")
      expect(result.output).not.toContain("3: two")
    }),
  )

  it.live("fails clearly for invalid spreadsheet input in ODS files", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const file = path.join(dir, "invalid.ods")
      yield* put(file, "not an ods workbook")

      const err = yield* fail(dir, file)

      expect(err.message).toContain("Cannot read spreadsheet file")
      expect(err.message).toContain("not a valid spreadsheet")
    }),
  )

  it.live("rejects spreadsheets larger than the parser input limit for ODS files", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const file = path.join(dir, "large-input.ods")
      yield* put(file, new Uint8Array([0x50, 0x4b]))
      yield* Effect.promise(() => truncate(file, 50 * 1024 * 1024 + 1))

      const err = yield* fail(dir, file)

      expect(err.message).toContain("Cannot read spreadsheet file")
      expect(err.message).toContain("exceeds the 50 MB size limit")
    }),
  )
})
