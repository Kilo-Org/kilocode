import * as path from "path"

const IMAGE_PREVIEW_ID = "imagePreview.previewEditor"

type Preview = {
  data: Uint8Array
  ext: string
  name: string
}

export function parseImage(dataUrl: string, filename: string): Preview | null {
  const sep = dataUrl.indexOf(",")
  if (sep === -1) return null

  const head = dataUrl.slice(0, sep)
  const mime = head.match(/^data:(image\/[A-Za-z0-9.+-]+);base64$/)?.[1]
  if (!mime) return null

  const data = parseBase64(dataUrl.slice(sep + 1))
  if (!data) return null

  const ext = getExt(mime)
  const name = buildName(filename, ext)
  return { data, ext, name }
}

export function buildPreviewPath(name: string, now: number): string {
  return path.posix.join("image-preview", `${now}-${name}`)
}

export function getPreviewCommand(uri: {
  toString(): string
}): [string, { resource: { toString(): string }; size: "contain" }] {
  return [IMAGE_PREVIEW_ID, { resource: uri, size: "contain" }]
}

function parseBase64(value: string): Uint8Array | null {
  try {
    return Buffer.from(value, "base64")
  } catch {
    return null
  }
}

function getExt(mime: string): string {
  const raw = mime.split("/")[1] ?? "png"
  if (raw === "jpeg") return "jpg"
  if (raw === "svg+xml") return "svg"
  return raw
}

function buildName(filename: string, ext: string): string {
  const raw = path.basename(filename || "image")
  const item = path.parse(raw)
  const base = sanitize(item.name) || "image"
  const tail = sanitize(item.ext.replace(/^\./, ""))
  const clean = tail ? `${base}.${tail}` : base
  if (path.extname(clean)) return clean
  return `${clean}.${ext}`
}

function sanitize(value: string): string {
  return value
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}
