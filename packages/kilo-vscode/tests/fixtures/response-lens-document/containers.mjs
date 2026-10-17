import { zipSync, strToU8, Zip, ZipDeflate } from "fflate"
import { deflateSync } from "node:zlib"

export const xml = (text = "First DOCX paragraph.") =>
  `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p><w:p><w:r><w:t>Second paragraph</w:t><w:tab/><w:t>with a tab.</w:t><w:br/><w:t>Next line.</w:t></w:r></w:p></w:body></w:document>`

// These are real, deterministic OOXML ZIP files, not parser stubs. Only the document entry is read.
export function docx(document = xml(), entries = {}) {
  return zipSync(
    {
      "[Content_Types].xml": strToU8(
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
      "_rels/.rels": strToU8(
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      ),
      "word/document.xml": strToU8(document),
      ...entries,
    },
    { level: 9 },
  )
}

export function streaming(document) {
  const chunks = []
  const zip = new Zip((error, chunk) => {
    if (error) throw error
    chunks.push(chunk)
  })
  const entry = new ZipDeflate("word/document.xml", { level: 9 })
  zip.add(entry)
  entry.push(strToU8(document), true)
  zip.end()
  return Buffer.concat(chunks)
}

// Build genuine PDF 1.4 objects, streams, byte-offset xref table and trailer.
// An image-only page exercises scanned-document rejection without OCR or canvas.
export function pdf(
  pages = ["Page 1"],
  { scanned = false, encrypted = false, actions = false, compressed = false } = {},
) {
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R ${actions ? '/OpenAction << /S /JavaScript /JS (throw new Error("PDF_SCRIPT_SENTINEL")) >>' : ""} >>`,
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, index) => `${4 + index * 2} 0 R`).join(" ")}] >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]
  for (const text of pages) {
    const index = objects.length + 1
    const escaped = text.replace(/[\\()]/g, "\\$&")
    const stream = scanned
      ? "q 10 0 0 10 0 0 cm BI /W 1 /H 1 /CS /DeviceGray /BPC 8 /F /ASCIIHexDecode ID 00> EI Q"
      : `BT /F1 12 Tf 50 750 Td (${escaped}) Tj ET`
    const content = compressed ? `${deflateSync(Buffer.from(stream)).toString("hex")}>` : stream
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${Math.max(612, text.length * 12 + 100)} 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${index + 1} 0 R >>`,
    )
    objects.push(
      `<< /Length ${Buffer.byteLength(content)} ${compressed ? "/Filter [/ASCIIHexDecode /FlateDecode]" : ""} >>\nstream\n${content}\nendstream`,
    )
  }
  if (encrypted)
    objects.push(`<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${"00".repeat(32)}> /U <${"00".repeat(32)}> /P -4 >>`)
  let text = "%PDF-1.4\n"
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(text))
    text += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const start = Buffer.byteLength(text)
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets.slice(1)) text += `${String(offset).padStart(10, "0")} 00000 n \n`
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${encrypted ? `/Encrypt ${objects.length} 0 R /ID [<00112233><00112233>]` : ""} >>\nstartxref\n${start}\n%%EOF\n`
  return Buffer.from(text)
}
