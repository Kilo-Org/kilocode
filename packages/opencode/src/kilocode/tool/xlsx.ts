import path from "path"
import { Readable } from "stream"
import { read, utils, type CellObject, type WorkBook } from "xlsx"

const ROW_LIMIT = 50_000
const MAX_SIZE = 50 * 1024 * 1024
const MAX_SIZE_LABEL = `${MAX_SIZE / (1024 * 1024)} MB`

export function is(filepath: string) {
  return path.extname(filepath).toLowerCase() === ".xlsx"
}

export async function open(filepath: string) {
  const file = Bun.file(filepath)
  if (file.size > MAX_SIZE) {
    throw new Error(`Cannot read spreadsheet file: ${filepath} exceeds the ${MAX_SIZE_LABEL} size limit`)
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error(`Cannot read spreadsheet file: ${filepath} is not a valid XLSX workbook`)
  }

  try {
    const book = read(bytes, { type: "array", cellDates: true })
    return Readable.from(lines(book))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Cannot read spreadsheet file: ${filepath}: ${message}`, { cause: err })
  }
}

function cell(value: CellObject | undefined) {
  if (!value) return ""
  if (value.f) {
    if (value.w !== undefined && value.w !== null) return value.w
    if (value.v !== undefined && value.v !== null) return String(value.v)
    return `[Formula: ${value.f}]`
  }
  if (value.v === undefined || value.v === null) return ""
  if (value.t === "e") return `[Error: ${value.w ?? String(value.v)}]`
  if (value.t === "d") return value.v instanceof Date ? value.v.toISOString().slice(0, 10) : String(value.v)
  if (value.l?.Target) return `${value.w ?? String(value.v)} (${value.l.Target})`
  return value.w ?? String(value.v)
}

function* lines(book: WorkBook) {
  const sheets = book.SheetNames.filter((_, index) => {
    const hidden = book.Workbook?.Sheets?.[index]?.Hidden
    return hidden !== 1 && hidden !== 2
  })
  for (const [index, name] of sheets.entries()) {
    if (index > 0) yield "\n"
    yield `--- Sheet: ${name} ---\n`

    const sheet = book.Sheets[name]
    if (!sheet?.["!ref"]) continue
    const range = utils.decode_range(sheet["!ref"])
    const end = Math.min(range.e.r, ROW_LIMIT - 1)
    const rows = new Map<number, Map<number, string>>()
    for (const key of Object.keys(sheet)) {
      if (key.startsWith("!")) continue
      const pos = utils.decode_cell(key)
      if (pos.r < range.s.r || pos.r > end || pos.c < range.s.c || pos.c > range.e.c) continue
      const value = cell(sheet[key])
      if (!value.trim()) continue
      const row = rows.get(pos.r) ?? new Map<number, string>()
      row.set(pos.c, value)
      rows.set(pos.r, row)
    }

    for (const values of [...rows.entries()].sort((a, b) => a[0] - b[0]).map((entry) => entry[1])) {
      const last = Math.max(...values.keys())
      const row = Array.from({ length: last - range.s.c + 1 }, (_, col) => values.get(col + range.s.c) ?? "")
      yield row.join("\t") + "\n"
    }
    if (range.e.r > end) yield `[... truncated at row ${ROW_LIMIT} ...]\n`
  }
}
