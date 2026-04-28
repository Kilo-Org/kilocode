import fs from "fs/promises"
import path from "path"
import * as mammoth from "mammoth"
import * as XLSX from "xlsx"
import * as PDFJS from "pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js"

const ROW_LIMIT = 50000
const FORMATS = new Set([".pdf", ".docx", ".ipynb", ".xlsx"])

type Notebook = {
  cells?: Array<{
    cell_type?: string
    source?: string | string[]
  }>
}

type Cell = XLSX.CellObject & {
  r?: Array<{ t?: string }>
}

type PDFItem = {
  str: string
  transform: number[]
}

export namespace Document {
  export type View = {
    raw: string[]
    count: number
    cut: boolean
    more: boolean
    offset: number
  }

  export function isSupported(filepath: string) {
    return FORMATS.has(path.extname(filepath).toLowerCase())
  }

  export async function extract(filepath: string) {
    const ext = path.extname(filepath).toLowerCase()
    if (ext === ".pdf") return extractPDF(filepath)
    if (ext === ".docx") return extractDOCX(filepath)
    if (ext === ".ipynb") return extractIPYNB(filepath)
    if (ext === ".xlsx") return extractXLSX(filepath)
    throw new Error(`Cannot read text for file type: ${ext}`)
  }

  export async function read(
    filepath: string,
    opts: { limit: number; offset: number; bytes: number; length: number; suffix: string },
  ) {
    const text = await extract(filepath)
    return view(text, opts)
  }
}

function view(
  text: string,
  opts: { limit: number; offset: number; bytes: number; length: number; suffix: string },
): Document.View {
  const rows = text === "" ? [] : text.split(/\r\n|\n|\r/)
  if (rows.at(-1) === "") rows.pop()

  const start = opts.offset - 1
  const raw: string[] = []
  let bytes = 0
  let cut = false
  let more = false

  for (let i = start; i < rows.length; i++) {
    if (raw.length >= opts.limit) {
      more = true
      continue
    }

    const row = rows[i]
    const line = row.length > opts.length ? row.substring(0, opts.length) + opts.suffix : row
    const size = Buffer.byteLength(line, "utf-8") + (raw.length > 0 ? 1 : 0)
    if (bytes + size > opts.bytes) {
      cut = true
      more = true
      break
    }

    raw.push(line)
    bytes += size
  }

  return { raw, count: rows.length, cut, more, offset: opts.offset }
}

async function extractPDF(filepath: string) {
  const data = await fs.readFile(filepath)
  const doc = await PDFJS.getDocument(data)
  const max = doc.numPages
  let text = ""

  for (let i = 1; i <= max; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent({
      normalizeWhitespace: false,
      disableCombineTextItems: false,
    })
    let last: number | undefined
    let rendered = ""

    for (const item of content.items as PDFItem[]) {
      if (last === item.transform[5] || !last) {
        rendered += item.str
      } else {
        rendered += `\n${item.str}`
      }
      last = item.transform[5]
    }

    text = `${text}\n\n--- Page ${i} ---\n${rendered}`
  }

  doc.destroy()
  return text.trim()
}

async function extractDOCX(filepath: string) {
  const data = await mammoth.extractRawText({ path: filepath })
  return data.value
}

async function extractIPYNB(filepath: string) {
  const data = await fs.readFile(filepath, "utf8")
  const note = JSON.parse(data) as Notebook
  let text = ""

  for (const cell of note.cells ?? []) {
    if ((cell.cell_type === "markdown" || cell.cell_type === "code") && cell.source) {
      text += (cell.source as string[]).join("\n") + "\n"
    }
  }

  return text
}

function value(cell: Cell | undefined) {
  if (!cell) return ""

  if (cell.f) {
    if (cell.w !== undefined && cell.w !== null) return cell.w
    if (cell.v !== undefined && cell.v !== null) return cell.v.toString()
    return `[Formula: ${cell.f}]`
  }

  if (cell.v === null || cell.v === undefined) return ""
  if (cell.t === "e") return `[Error: ${cell.w || cell.v}]`
  if (cell.t === "d") return (cell.v as Date).toISOString().split("T")[0]

  if (cell.t === "n" && cell.w && isDate(cell.z)) {
    try {
      const date = XLSX.SSF.parse_date_code(cell.v as number)
      return `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`
    } catch {
      return cell.w
    }
  }

  if (Array.isArray(cell.r)) return cell.r.map((item) => item.t || "").join("")

  if (cell.l?.Target) {
    const text = cell.w || cell.v?.toString() || ""
    return `${text} (${cell.l.Target})`
  }

  return cell.w || cell.v?.toString() || ""
}

function isDate(fmt: string | number | undefined) {
  if (!fmt) return false
  const lower = fmt.toString().toLowerCase()
  return ["d", "m", "y", "h", "s"].some((item) => lower.includes(item))
}

async function extractXLSX(filepath: string) {
  const book = XLSX.readFile(filepath, { cellDates: true })
  let text = ""

  book.SheetNames.forEach((name, i) => {
    const sheet = book.Sheets[name]
    const info = book.Workbook?.Sheets?.[i]
    if (info?.Hidden === 1 || info?.Hidden === 2) return

    text += `--- Sheet: ${name} ---\n`
    const range = XLSX.utils.decode_range(sheet["!ref"] || "A1")

    for (let row = range.s.r; row <= range.e.r && row < ROW_LIMIT; row++) {
      const items: string[] = []
      let found = false

      for (let col = range.s.c; col <= range.e.c; col++) {
        const addr = XLSX.utils.encode_cell({ r: row, c: col })
        const cell = value(sheet[addr] as Cell | undefined)
        if (cell.trim()) found = true
        items.push(cell)
      }

      if (found) text += `${items.join("\t")}\n`
    }

    if (range.e.r >= ROW_LIMIT) text += `[... truncated at row ${ROW_LIMIT} ...]\n`
    text += "\n"
  })

  return text.trim()
}
