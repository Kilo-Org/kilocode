import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { truncate } from "fs/promises"
import path from "path"
import { write, utils, type WorkBook, type WorkSheet } from "xlsx"
import { TextReader, TextWriter, Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter } from "@zip.js/zip.js"
import { Environment } from "@opencode/core/environment/index"
import { AbsolutePath } from "@opencode/core/schema"
import { ReadTool } from "@opencode/core/tool/plugin/read"
import { hostEnvironmentLayer } from "../../core/test/fixture/environment"
import { withTempDir } from "../../core/test/fixture/tmpdir"
import { testEffect } from "../../core/test/lib/effect"
import { read } from "../src/read"

const it = testEffect(hostEnvironmentLayer)

const run = (file: string, page: { limit?: number; offset?: number } = {}) =>
  Effect.gen(function* () {
    const environment = yield* Environment.Service
    const value = yield* read(environment.files, AbsolutePath.make(file), path.basename(file), page)
    if (value.type !== "text-page") throw new Error(`expected a text page, got ${value.type}`)
    return { page: value, output: ReadTool.toModelContent(path.basename(file), undefined, value) }
  })

const fail = (file: string) =>
  Effect.gen(function* () {
    const environment = yield* Environment.Service
    return yield* read(environment.files, AbsolutePath.make(file), path.basename(file)).pipe(Effect.flip)
  })

function bytes(book: WorkBook) {
  return new Uint8Array(write(book, { bookType: "xlsx", type: "buffer" }) as Uint8Array)
}

function bytesODS(book: WorkBook) {
  return new Uint8Array(write(book, { bookType: "ods", type: "buffer" }) as Uint8Array)
}

function fixture(name: string) {
  return Bun.file(path.join(import.meta.dir, "fixture/spreadsheet", name)).bytes()
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

// SheetJS writes ODS dates and times as plain values, so tests hand it the XML LibreOffice writes for them.
async function calc(content: string) {
  const output = new ZipWriter(new Uint8ArrayWriter())
  await output.add("mimetype", new TextReader("application/vnd.oasis.opendocument.spreadsheet"), {
    level: 0,
    dataDescriptor: false,
  })
  await output.add(
    "META-INF/manifest.xml",
    new TextReader('<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"/>'),
  )
  await output.add("styles.xml", new TextReader(`<office:document-styles ${ODS}/>`))
  await output.add(
    "content.xml",
    new TextReader(`<office:document-content ${ODS}>${content}</office:document-content>`),
  )
  return output.close()
}

const ODS = [
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"',
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"',
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
  'xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0"',
].join(" ")

function book(sheet: WorkSheet, name = "Visible") {
  const value = utils.book_new()
  utils.book_append_sheet(value, sheet, name)
  return value
}

const put = (file: string, value: string | Uint8Array | Promise<Uint8Array>) =>
  Effect.promise(async () => Bun.write(file, await value))

describe("kilo XLSX reads", () => {
  it.live("extracts labelled formatted content from case-variant XLSX files", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const sheet: WorkSheet = {
          A1: { t: "s", v: "Link", l: { Target: "https://kilo.ai" } },
          B1: { t: "d", v: new Date("2026-05-29T00:00:00.000Z") },
          C1: { t: "n", v: 42, f: "SUM(40,2)" },
          D1: { t: "e", v: 0x07, w: "#DIV/0!" },
          C2: { t: "n", f: "SUM(C1:C1)" },
          A4: { t: "s", v: "After blank row" },
          "!ref": "A1:D4",
        }
        const file = path.join(tmp.path, "report.XLSX")
        yield* put(file, bytes(book(sheet)))

        const result = yield* run(file)

        expect(result.output).toContain("--- Sheet: Visible ---")
        expect(result.output).toContain("Link (https://kilo.ai)")
        expect(result.output).toContain("2026-05-29")
        expect(result.output).toContain("42")
        expect(result.output).toContain("[Formula: SUM(C1:C1)]")
        expect(result.output).toContain("[Error: #DIV/0!]")
        expect(result.output).toContain("After blank row")
      }),
    ),
  )

  it.live("reads date cells as ISO dates with their time of day", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const sheet: WorkSheet = {
          A1: { t: "d", v: new Date("2026-05-29T00:00:00.000Z"), z: "yyyy-mm-dd" },
          B1: { t: "d", v: new Date("2026-05-29T14:05:00.000Z"), z: "m/d/yy h:mm" },
          C1: { t: "d", v: new Date("2026-05-29T09:30:00.000Z"), z: "DD.MM.YYYY HH:MM" },
          D1: { t: "d", v: new Date("2026-05-01T00:00:00.000Z"), z: "mmm yyyy" },
          E1: { t: "d", v: new Date("2026-05-29T00:00:00.000Z"), z: "d-mmm" },
          F1: { t: "d", v: new Date("2026-05-01T00:00:00.000Z"), z: "mmm" },
          G1: { t: "d", v: new Date("2026-05-01T00:00:00.000Z"), z: "MMMM" },
          "!ref": "A1:G1",
        }
        const file = path.join(tmp.path, "dates.xlsx")
        yield* put(file, bytes(book(sheet)))

        const result = yield* run(file)

        expect(result.output).toContain(
          "2: 2026-05-29\t2026-05-29 14:05:00\t2026-05-29 09:30:00\t2026-05-01\t2026-05-29\t2026-05-01\t2026-05-01",
        )
      }),
    ),
  )

  it.live("reads times of day and durations as the cells show them", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const sheet: WorkSheet = {
          A1: { t: "n", v: 0.25, z: "h:mm" },
          B1: { t: "n", v: 1.5, z: "[h]:mm:ss" },
          C1: { t: "n", v: 0.5, z: "[$-x-systime]h:mm:ss AM/PM" },
          D1: { t: "n", v: 0.75, z: 'h:mm" daily"' },
          E1: { t: "n", v: 0.75, z: "h:mm\\ \\d\\a\\i\\l\\y" },
          F1: { t: "n", v: 1.5, z: "[h]" },
          G1: { t: "n", v: (25 * 3600 + 30) / 86400, z: "[ss]" }, // 25 hours and 30 seconds
          "!ref": "A1:G1",
        }
        const file = path.join(tmp.path, "times.xlsx")
        yield* put(file, bytes(book(sheet)))

        const result = yield* run(file)

        expect(result.output).toContain("2: 6:00\t36:00:00\t12:00:00 PM\t18:00 daily\t18:00 daily\t36\t90030")
      }),
    ),
  )

  it.live("omits hidden and very-hidden worksheets", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const value = book(utils.aoa_to_sheet([["Visible content"]]))
        utils.book_append_sheet(value, utils.aoa_to_sheet([["Hidden content"]]), "Hidden")
        utils.book_append_sheet(value, utils.aoa_to_sheet([["Secret content"]]), "Secret")
        value.Workbook = { Sheets: [{ Hidden: 0 }, { Hidden: 1 }, { Hidden: 2 }] }
        const file = path.join(tmp.path, "sheets.xlsx")
        yield* put(file, bytes(value))

        const result = yield* run(file)

        expect(result.output).toContain("Visible content")
        expect(result.output).not.toContain("Hidden content")
        expect(result.output).not.toContain("Secret content")
      }),
    ),
  )

  it.live("caps worksheet extraction rows before ordinary read limits", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const sheet = utils.aoa_to_sheet(Array.from({ length: 50_001 }, (_, row) => [`row-${row + 1}`]))
        const file = path.join(tmp.path, "large.xlsx")
        yield* put(file, bytes(book(sheet)))

        const result = yield* run(file, { offset: 49_999, limit: 4 })

        expect(result.output).toContain("row-50000")
        expect(result.output).not.toContain("row-50001")
        expect(result.output).toContain("[... truncated at row 50000 ...]")
      }),
    ),
  )

  it.live("applies ordinary read line limits to spreadsheet text", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const file = path.join(tmp.path, "limited.xlsx")
        yield* put(file, bytes(book(utils.aoa_to_sheet([["one"], ["two"], ["three"]]))))

        const result = yield* run(file, { limit: 2 })

        expect(result.page.truncated).toBe(true)
        expect(result.page.next).toBe(3)
        expect(result.output).toContain("1: --- Sheet: Visible ---")
        expect(result.output).toContain("2: one")
        expect(result.output).not.toContain("3: two")
      }),
    ),
  )

  it.live("does not traverse every blank cell in a sparse wide range", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const file = path.join(tmp.path, "sparse.xlsx")
        yield* put(file, range(bytes(book(utils.aoa_to_sheet([["first"]])))))

        const result = yield* run(file)

        expect(result.output).toContain("--- Sheet: Visible ---")
        expect(result.output).toContain("first")
        expect(result.output).toContain("[... truncated at row 50000 ...]")
      }),
    ),
  )

  it.live("reads only the file size instead of reserving the spreadsheet limit", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const file = path.join(tmp.path, "small.xlsx")
        yield* put(file, bytes(book(utils.aoa_to_sheet([["small"]]))))
        const environment = yield* Environment.Service
        const ranges: Array<{ offset: number; length: number } | undefined> = []
        const files = {
          ...environment.files,
          read: (value: string, range?: { offset: number; length: number }) => {
            ranges.push(range)
            return environment.files.read(value, range)
          },
        }
        yield* read(files, AbsolutePath.make(file), path.basename(file))

        expect(ranges[0]?.length).toBe((yield* environment.files.stat(file)).size + 1)
      }),
    ),
  )

  it.live("fails clearly for invalid spreadsheet input", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const file = path.join(tmp.path, "invalid.xlsx")
        yield* put(file, "not an xlsx workbook")

        const error = yield* fail(file)

        expect(error.message).toContain("Cannot read spreadsheet file")
        expect(error.message).toContain("not a valid spreadsheet")
      }),
    ),
  )

  it.live("rejects spreadsheets larger than the parser input limit", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const file = path.join(tmp.path, "large-input.xlsx")
        yield* put(file, new Uint8Array([0x50, 0x4b]))
        yield* Effect.promise(() => truncate(file, 50 * 1024 * 1024 + 1))

        const error = yield* fail(file)

        expect(error.message).toContain("Cannot read spreadsheet file")
        expect(error.message).toContain("exceeds the 50 MB size limit")
      }),
    ),
  )

  it.live("continues rejecting unsupported workbook formats as binary", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const file = path.join(tmp.path, "legacy.xls")
        yield* put(file, bytes(book(utils.aoa_to_sheet([["ignored"]]))))

        const error = yield* fail(file)

        expect(error.message).toContain("Cannot read binary file")
      }),
    ),
  )

  it.live("continues returning PDF files as native attachments", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const file = path.join(tmp.path, "native.pdf")
        yield* put(file, "%PDF-1.7\n")

        const environment = yield* Environment.Service
        const value = yield* read(environment.files, AbsolutePath.make(file), path.basename(file))

        expect(value.type).toBe("file")
        if (value.type === "file") {
          expect(value.mime).toBe("application/pdf")
          expect(value.encoding).toBe("base64")
        }
      }),
    ),
  )
})

describe("kilo ODS reads", () => {
  it.live("extracts labelled formatted content from case-variant ODS files", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const sheet: WorkSheet = {
          A1: { t: "s", v: "Link", l: { Target: "https://kilo.ai" } },
          B1: { t: "d", v: new Date("2026-05-29T00:00:00.000Z") },
          C1: { t: "n", v: 42 },
          A4: { t: "s", v: "After blank row" },
          "!ref": "A1:C4",
        }
        const file = path.join(tmp.path, "report.ODS")
        yield* put(file, bytesODS(book(sheet)))

        const result = yield* run(file)

        expect(result.output).toContain("--- Sheet: Visible ---")
        expect(result.output).toContain("Link (https://kilo.ai)")
        expect(result.output).toContain("2026-05-29")
        expect(result.output).toContain("42")
        expect(result.output).toContain("After blank row")
      }),
    ),
  )

  it.live("keeps the time of date cells and reads times of day and durations as shown in ODS files", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const file = path.join(tmp.path, "times.ods")
        const styles = [
          '<number:date-style style:name="N1"><number:year number:style="long"/><number:text>-</number:text><number:month number:style="long"/><number:text>-</number:text><number:day number:style="long"/><number:text> </number:text><number:hours number:style="long"/><number:text>:</number:text><number:minutes number:style="long"/></number:date-style>',
          '<number:time-style style:name="N2"><number:hours number:style="long"/><number:text>:</number:text><number:minutes number:style="long"/></number:time-style>',
          '<number:time-style style:name="N3" number:truncate-on-overflow="false"><number:hours/><number:text>:</number:text><number:minutes number:style="long"/><number:text>:</number:text><number:seconds number:style="long"/></number:time-style>',
          '<style:style style:name="ce1" style:family="table-cell" style:data-style-name="N1"/>',
          '<style:style style:name="ce2" style:family="table-cell" style:data-style-name="N2"/>',
          '<style:style style:name="ce3" style:family="table-cell" style:data-style-name="N3"/>',
        ]
        const cells = [
          '<table:table-cell table:style-name="ce1" office:value-type="date" office:date-value="2026-05-29T14:05:00"><text:p>2026-05-29 14:05</text:p></table:table-cell>',
          '<table:table-cell table:style-name="ce2" office:value-type="time" office:time-value="PT06H00M00S"><text:p>06:00</text:p></table:table-cell>',
          '<table:table-cell table:style-name="ce3" office:value-type="time" office:time-value="PT36H00M00S"><text:p>36:00:00</text:p></table:table-cell>',
        ]
        const content = [
          `<office:automatic-styles>${styles.join("")}</office:automatic-styles>`,
          `<office:body><office:spreadsheet><table:table table:name="Times"><table:table-row>${cells.join("")}</table:table-row></table:table></office:spreadsheet></office:body>`,
        ]
        yield* put(file, calc(content.join("")))

        const result = yield* run(file)

        expect(result.output).toContain("--- Sheet: Times ---")
        expect(result.output).toContain("2: 2026-05-29 14:05:00\t06:00\t36:00:00")
      }),
    ),
  )

  it.live("extracts content from all sheets in ODS files", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const value = book(utils.aoa_to_sheet([["Visible content"]]))
        utils.book_append_sheet(value, utils.aoa_to_sheet([["Other content"]]), "Other")
        const file = path.join(tmp.path, "sheets.ods")
        yield* put(file, bytesODS(value))

        const result = yield* run(file)

        expect(result.output).toContain("Visible content")
        expect(result.output).toContain("Other content")
      }),
    ),
  )

  it.live("extracts repeated non-empty cells from OpenOffice ODS files", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const file = path.join(tmp.path, "repeated-cells.ods")
        yield* put(file, fixture("repeated-cells.ods"))

        const result = yield* run(file)

        expect(result.output).toContain("--- Sheet: Sheet1 ---")
        expect(result.output).toContain("1\t1")
      }),
    ),
  )

  it.live("omits style-hidden worksheets from LibreOffice ODS files", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const file = path.join(tmp.path, "hidden-sheet.ods")
        yield* put(file, fixture("hidden-sheet.ods"))

        const result = yield* run(file)

        expect(result.output).toContain("--- Sheet: Ranges ---")
        expect(result.output).not.toContain("--- Sheet: Sheet1 ---")
        expect(result.output).not.toContain("Invisible")
      }),
    ),
  )

  it.live("caps worksheet extraction rows before ordinary read limits in ODS files", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const sheet = utils.aoa_to_sheet(Array.from({ length: 50_001 }, (_, row) => [`row-${row + 1}`]))
        const file = path.join(tmp.path, "large.ods")
        yield* put(file, bytesODS(book(sheet)))

        const result = yield* run(file, { offset: 49_999, limit: 4 })

        expect(result.output).toContain("row-50000")
        expect(result.output).not.toContain("row-50001")
        expect(result.output).toContain("[... truncated at row 50000 ...]")
      }),
    ),
  )

  it.live("applies ordinary read line limits to spreadsheet text in ODS files", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const file = path.join(tmp.path, "limited.ods")
        yield* put(file, bytesODS(book(utils.aoa_to_sheet([["one"], ["two"], ["three"]]))))

        const result = yield* run(file, { limit: 2 })

        expect(result.page.truncated).toBe(true)
        expect(result.output).toContain("1: --- Sheet: Visible ---")
        expect(result.output).toContain("2: one")
        expect(result.output).not.toContain("3: two")
      }),
    ),
  )

  it.live("fails clearly for invalid spreadsheet input in ODS files", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const file = path.join(tmp.path, "invalid.ods")
        yield* put(file, "not an ods workbook")

        const error = yield* fail(file)

        expect(error.message).toContain("Cannot read spreadsheet file")
        expect(error.message).toContain("not a valid spreadsheet")
      }),
    ),
  )

  it.live("rejects spreadsheets larger than the parser input limit for ODS files", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const file = path.join(tmp.path, "large-input.ods")
        yield* put(file, new Uint8Array([0x50, 0x4b]))
        yield* Effect.promise(() => truncate(file, 50 * 1024 * 1024 + 1))

        const error = yield* fail(file)

        expect(error.message).toContain("Cannot read spreadsheet file")
        expect(error.message).toContain("exceeds the 50 MB size limit")
      }),
    ),
  )
})
