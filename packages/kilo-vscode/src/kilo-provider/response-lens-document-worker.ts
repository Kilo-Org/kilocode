import { Parser } from "htmlparser2"
import { Unzip, UnzipInflate } from "fflate"
import { getDocumentProxy } from "unpdf"
import { MemoryRedact } from "@kilocode/kilo-memory/redact"

const CHARS = 100_000
const RAW = 1024 * 1024
const PAGES = 30
const XML = 2 * 1024 * 1024
const skipped = new Set(
  "head script style noscript iframe object embed template nav footer aside svg canvas form button select textarea".split(
    " ",
  ),
)
const blocks = new Set(
  "address article blockquote br dd div dl dt fieldset figcaption figure h1 h2 h3 h4 h5 h6 header hr li main ol p pre section table tr ul".split(
    " ",
  ),
)
const crc = Uint32Array.from({ length: 256 }, (_, byte) => {
  let value = byte
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
  return value >>> 0
})

class Unsupported extends Error {}

function decode(bytes: Uint8Array) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "")
  if (/[\x00-\x08\x0B\x0E-\x1F\x7F]/.test(text))
    throw new Unsupported("Document contains binary or unsupported control characters.")
  return text
}

function collect() {
  let text = ""
  let size = 0
  return {
    add(value: string) {
      size += Buffer.byteLength(value)
      if (size > RAW) throw new Unsupported("Document raw text exceeds the 1 MiB safety limit.")
      text += value
    },
    get text() {
      return text
    },
  }
}

// This function accepts sanitized text only. Plain text must retain source line coordinates.
function present(text: string, detail: string, limit = CHARS, normalize = false) {
  const value = normalize
    ? text
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
    : text
  return { text: value.slice(0, limit).replace(/[\uD800-\uDBFF]$/, ""), detail, truncated: value.length > limit }
}

function markup() {
  const raw = collect()
  const flags: number[] = []
  let line = 0
  return {
    // Visibility bits: 1 = visible, 2 = body, 4 = selected, 8 = omitted.
    // Keep omitted text as redaction context, but never return its lines.
    add(value: string, mask = 0) {
      const text = value.replace(/\r\n?/g, "\n")
      raw.add(text)
      const parts = text.split("\n")
      for (const [index, part] of parts.entries()) {
        if (part.trim()) flags[line] = (flags.at(line) ?? 0) | mask
        if (index < parts.length - 1) line++
      }
    },
    select() {
      // lines() preserves separators, so filtering cannot uncover a redacted PEM body.
      const safe = MemoryRedact.lines(raw.text).split("\n")
      return (mask: number) =>
        safe
          .filter((value, index) => {
            const flag = flags.at(index) ?? 0
            return !(flag & 8) && (!!(flag & mask) || !value.trim())
          })
          .join("\n")
    },
  }
}

function html(text: string, fragment?: string) {
  const result = markup()
  const target = (() => {
    const raw = fragment?.replace(/^#/, "") ?? ""
    try {
      return decodeURIComponent(raw)
    } catch {
      return raw
    }
  })()
  const stack: { skip: boolean; body: boolean; selected: boolean; pre: boolean }[] = []
  let found = false
  let hasBody = false
  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (stack.length >= 256) throw new Unsupported("HTML nesting exceeds the parser limit.")
        const parent = stack.at(-1) ?? { skip: false, body: false, selected: false, pre: false }
        const skip = parent.skip || skipped.has(name) || "hidden" in attrs || attrs["aria-hidden"] === "true"
        const match = !skip && !found && !!target && (attrs.id === target || (name === "a" && attrs.name === target))
        if (match) found = true
        if (name === "body") hasBody = true
        stack.push({
          skip,
          body: parent.body || name === "body",
          selected: parent.selected || match,
          pre: parent.pre || name === "pre",
        })
        if (blocks.has(name) || skip) result.add("\n\n")
        if (name === "td" || name === "th") result.add("\t")
      },
      ontext(value) {
        const state = stack.at(-1)
        const mask = state?.skip ? 8 : 1 | (state?.body ? 2 : 0) | (state?.selected ? 4 : 0)
        result.add(state?.pre ? value : value.replace(/\s+/g, " "), mask)
      },
      onclosetag(name) {
        if (blocks.has(name) || stack.at(-1)?.skip) result.add("\n\n")
        stack.pop()
      },
    },
    { decodeEntities: true },
  )
  parser.end(text)
  const select = result.select()
  const selected = found ? select(4) : ""
  const body = selected.trim() ? selected : select(hasBody ? 2 : 1)
  const detail = selected.trim()
    ? "HTML selected fragment with line context; text-only excerpt."
    : target
      ? "HTML body text; fragment unavailable."
      : "HTML body text; text-only excerpt."
  return present(MemoryRedact.lines(body), detail, CHARS, true)
}

// Inspect only ZIP headers. No archive name is ever used as a filesystem path.
function entry(bytes: Uint8Array, data: DataView, offset: number, end: number, start: number) {
  if (offset + 46 > end || data.getUint32(offset, true) !== 0x02014b50)
    throw new Unsupported("Malformed DOCX archive entry.")
  const length = data.getUint16(offset + 28, true)
  const next = offset + 46 + length + data.getUint16(offset + 30, true) + data.getUint16(offset + 32, true)
  if (next > end || length > 1024 || data.getUint16(offset + 8, true) & 1)
    throw new Unsupported("Encrypted or malformed DOCX archives are unsupported.")
  const name = decode(bytes.subarray(offset + 46, offset + 46 + length))
  if (
    !name ||
    /[\\:\x00]/.test(name) ||
    name.startsWith("/") ||
    name.split("/").some((part) => part === ".." || part === ".")
  )
    throw new Unsupported("Unsafe DOCX archive path.")
  const size = data.getUint32(offset + 20, true)
  const expanded = data.getUint32(offset + 24, true)
  const local = data.getUint32(offset + 42, true)
  if (local + 30 > start || data.getUint32(local, true) !== 0x04034b50)
    throw new Unsupported("Malformed DOCX local entry.")
  if (
    data.getUint16(local + 6, true) !== data.getUint16(offset + 8, true) ||
    data.getUint16(local + 8, true) !== data.getUint16(offset + 10, true)
  )
    throw new Unsupported("DOCX entry flags or compression mismatch.")
  const content = local + 30 + data.getUint16(local + 26, true) + data.getUint16(local + 28, true)
  if (
    content + size > start ||
    decode(bytes.subarray(local + 30, local + 30 + data.getUint16(local + 26, true))) !== name
  )
    throw new Unsupported("Malformed DOCX entry path or size.")
  return { name, size, expanded, next, checksum: data.getUint32(offset + 16, true) }
}

function archive(bytes: Uint8Array) {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const floor = Math.max(0, bytes.length - 65_557)
  let end = bytes.length - 22
  while (end >= floor && data.getUint32(end, true) !== 0x06054b50) end--
  if (end < floor || end + 22 + data.getUint16(end + 20, true) !== bytes.length)
    throw new Unsupported("Malformed DOCX archive.")
  const count = data.getUint16(end + 10, true)
  const start = data.getUint32(end + 16, true)
  if (data.getUint32(end + 4, true) || data.getUint16(end + 8, true) !== count || count === 0 || count > 256)
    throw new Unsupported("DOCX archive entry limit or unsupported ZIP format.")
  if (start + data.getUint32(end + 12, true) !== end) throw new Unsupported("Malformed DOCX archive directory.")
  const entries = new Map<string, ReturnType<typeof entry>>()
  let offset = start
  let expanded = 0
  for (let index = 0; index < count; index++) {
    const value = entry(bytes, data, offset, end, start)
    expanded += value.expanded
    if (
      value.size > bytes.length ||
      value.expanded > 4 * XML ||
      expanded > 8 * XML ||
      (value.name === "word/document.xml" && value.expanded > XML)
    )
      throw new Unsupported("DOCX archive expansion exceeds the parser limit.")
    if (entries.has(value.name)) throw new Unsupported("Duplicate DOCX archive path.")
    entries.set(value.name, value)
    offset = value.next
  }
  if (offset !== end || !entries.has("word/document.xml"))
    throw new Unsupported("DOCX has no supported document text entry.")
  return entries
}

function docx(bytes: Uint8Array) {
  const entries = archive(bytes)
  const chunks: Uint8Array[] = []
  let size = 0
  let count = 0
  let complete = false
  let checksum = 0xffffffff
  const seen = new Set<string>()
  const unzip = new Unzip((file) => {
    const entry = entries.get(file.name)
    if (++count > 256 || !entry || seen.has(file.name)) throw new Unsupported("Malformed DOCX archive entries.")
    seen.add(file.name)
    if (typeof file.size === "number" && file.size !== entry.size) throw new Unsupported("DOCX entry size mismatch.")
    if (typeof file.originalSize === "number" && file.originalSize !== entry.expanded)
      throw new Unsupported("DOCX expansion size mismatch.")
    if (file.name !== "word/document.xml") return
    file.ondata = (error, chunk, final) => {
      // UnzipInflate catches errors thrown by ondata and calls ondata again with that error.
      if (error) throw error instanceof Unsupported ? error : new Unsupported("DOCX decompression failed.")
      size += chunk.length
      if (size > XML || size > entry.expanded) throw new Unsupported("DOCX archive expansion exceeds the parser limit.")
      for (const byte of chunk) checksum = (checksum >>> 8) ^ crc[(checksum ^ byte) & 255]
      chunks.push(chunk)
      if (final) {
        if ((checksum ^ 0xffffffff) >>> 0 !== entry.checksum) throw new Unsupported("DOCX document checksum mismatch.")
        complete = size === entry.expanded
      }
    }
    file.start()
  })
  unzip.register(UnzipInflate)
  // A small compressed chunk bounds each synchronous inflater allocation, before ondata can enforce the total.
  for (let offset = 0; offset < bytes.length; offset += 256)
    unzip.push(bytes.subarray(offset, offset + 256), offset + 256 >= bytes.length)
  if (!complete || count !== entries.size) throw new Unsupported("Incomplete DOCX document entry.")
  const xml = decode(Buffer.concat(chunks))
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw new Unsupported("DOCX DTD and entity declarations are unsupported.")
  const result = markup()
  const stack: string[] = []
  let document = false
  let body = false
  let balanced = true
  const parser = new Parser(
    {
      onopentag(name) {
        if (stack.length >= 256) throw new Unsupported("DOCX XML nesting exceeds the parser limit.")
        if (name === "w:document" && !stack.length) document = true
        if (name === "w:body" && stack.at(-1) === "w:document") body = true
        stack.push(name)
        if (name === "w:p") result.add("\n\n")
        if (name === "w:br") result.add("\n")
        if (name === "w:tab") result.add("\t")
      },
      ontext(text) {
        const visible =
          stack.at(-1) === "w:t" && stack.includes("w:body") && stack.includes("w:p") && !stack.includes("w:del")
        result.add(text, visible ? 1 : 8)
      },
      onclosetag(name, implied) {
        if (implied && !xml.slice(parser.startIndex, parser.endIndex + 1).endsWith("/>")) balanced = false
        if (stack.pop() !== name) balanced = false
        if (name === "w:p") result.add("\n\n")
      },
      onend() {
        if (stack.length) balanced = false
      },
    },
    { xmlMode: true, decodeEntities: true },
  )
  parser.end(xml)
  if (!document || !body || !balanced || !xml.trimEnd().endsWith("</w:document>"))
    throw new Unsupported("Malformed or unsupported DOCX document XML.")
  return present(
    MemoryRedact.lines(result.select()(1)),
    "DOCX document paragraphs; text-only excerpt, not a layout rendering.",
    CHARS,
    true,
  )
}

async function pageText(
  document: Awaited<ReturnType<typeof getDocumentProxy>>,
  index: number,
  raw: ReturnType<typeof collect>,
) {
  const page = await document.getPage(index)
  const reader = page.streamTextContent({ includeMarkedContent: false }).getReader()
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      for (const item of chunk.value.items) {
        if (!("str" in item)) continue
        // A PDF text item's form feeds are text, not our page-boundary delimiter.
        raw.add(item.str.replace(/\f/g, "\n") + (item.hasEOL ? "\n" : " "))
      }
    }
  } finally {
    await reader.cancel(new Error("PDF text excerpt complete."))
    page.cleanup()
  }
}

async function pdf(bytes: Uint8Array, fragment?: string) {
  const match = /(?:^|[&#])page=(\d+)(?:&|$)/i.exec(fragment ?? "")
  if (!match && /(?:^|[&#])page=/i.test(fragment ?? "")) throw new Unsupported("PDF page fragment is invalid.")
  const start = match ? Number(match[1]) : 1
  if (!Number.isSafeInteger(start) || start < 1) throw new Unsupported("PDF page fragment is invalid.")
  const document = await getDocumentProxy(bytes, {
    // PDF.js 6 removed isEvalSupported; the child V8 flag forbids all string code generation.
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    disableAutoFetch: true,
    disableStream: true,
    disableRange: true,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    useWasm: false,
    cMapUrl: undefined,
    standardFontDataUrl: undefined,
    wasmUrl: undefined,
    maxImageSize: 0,
    fontExtraProperties: false,
    stopAtErrors: true,
    verbosity: 0,
    enableXfa: false,
    BinaryDataFactory: class {
      async fetch() {
        throw new Unsupported("Document external resource fetching is disabled.")
      }
    },
  })
  try {
    if ((await document.getPermissions()) !== null) throw new Unsupported("Encrypted PDFs are unsupported.")
    if (start > document.numPages) throw new Unsupported("PDF page fragment is outside the document.")
    // Unread pages could contain a PEM header for a body in the requested page.
    // Bound the whole document, then choose the six-page excerpt only after redaction.
    if (document.numPages > PAGES) throw new Unsupported("PDF exceeds the 30-page complete-redaction safety limit.")
    const raw = collect()
    const end = Math.min(document.numPages, start + 5)
    for (let index = 1; index <= document.numPages; index++) {
      if (index > 1) raw.add("\f")
      await pageText(document, index, raw)
    }
    const pages = MemoryRedact.lines(raw.text)
      .split("\f")
      .slice(start - 1, end)
      .map((text) => present(text, "", 20_000, true))
    const value = present(
      pages.map((page) => page.text).join("\n\n"),
      `PDF pages ${start}-${end} of ${document.numPages}; text-only excerpt, no OCR.`,
    )
    if (!value.text.trim())
      throw new Unsupported("PDF has no extractable text in the selected pages; scanned documents require OCR.")
    return { ...value, truncated: value.truncated || pages.some((page) => page.truncated) || end < document.numPages }
  } finally {
    await document.loadingTask.destroy()
  }
}

async function parse(input: string) {
  const request = JSON.parse(input)
  if (
    typeof request?.data !== "string" ||
    request.data.length > 1_398_104 ||
    request.data.length % 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(request.data)
  )
    throw new Unsupported("Invalid document parser input.")
  if (request.fragment !== undefined && (typeof request.fragment !== "string" || request.fragment.length > 4096))
    throw new Unsupported("Invalid document fragment.")
  const bytes = new Uint8Array(Buffer.from(request.data, "base64"))
  if (!bytes.length || bytes.length > 1024 * 1024) throw new Unsupported("Document must contain 1 byte to 1 MiB.")
  if (request.format === "pdf") return pdf(bytes, request.fragment)
  if (request.format === "docx") return docx(bytes)
  if (request.format === "html") return html(decode(bytes), request.fragment)
  if (request.format !== "text") throw new Unsupported("Unsupported document format.")
  const raw = collect()
  raw.add(decode(bytes))
  return present(MemoryRedact.lines(raw.text), "UTF-8 plain text.")
}

// PDF.js diagnostics must not corrupt the one-message protocol or disclose document content.
for (const method of ["log", "info", "warn", "error", "debug"] as const) console[method] = () => undefined
globalThis.fetch = async () => {
  throw new Unsupported("Document external resource fetching is disabled.")
}
const timer = setTimeout(() => finish({ error: "Document parsing exceeded its time limit." }), 4000)
let sent = false
function finish(value: object) {
  if (sent) return
  sent = true
  clearTimeout(timer)
  const json = JSON.stringify(value)
  const text =
    Buffer.byteLength(json) <= 650_000 ? json : JSON.stringify({ error: "Document parser exceeded its output limit." })
  process.stdout.write(text, () => process.exit(0))
}
const chunks: Buffer[] = []
let size = 0
process.stdin.on("data", (chunk: Buffer) => {
  size += chunk.length
  if (size > 1_450_000) return finish({ error: "Document parser input exceeds its limit." })
  chunks.push(chunk)
})
process.stdin.on("error", () => finish({ error: "Document parser input failed." }))
process.stdin.on("end", () => {
  void parse(Buffer.concat(chunks).toString("utf8")).then(
    (value) => {
      finish(value.text.trim() ? value : { error: "Document has no extractable text." })
    },
    (error: unknown) => {
      const password = error instanceof Error && error.name === "PasswordException"
      finish({
        error:
          error instanceof Unsupported
            ? error.message
            : password
              ? "Encrypted PDFs are unsupported."
              : "Malformed or unsupported document; text extraction failed.",
      })
    },
  )
})
