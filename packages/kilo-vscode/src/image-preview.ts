// `parseImage` and its helpers, ported from v1 `src/image-preview.ts`. The editor preview part is not ported yet.
import path from "node:path"
import { imageMime } from "./shared/image-data-url"

export function parseImage(dataUrl: string, filename: string) {
  const mime = imageMime(dataUrl)
  if (!mime) return null

  const data = parseBase64(dataUrl.slice(dataUrl.indexOf(",") + 1))
  if (!data) return null

  const ext = getExt(mime)
  const name = buildName(filename, ext)
  return { data, ext, name }
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
