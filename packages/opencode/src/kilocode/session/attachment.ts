import { isImageAttachment } from "@/util/media"
import { Image } from "@/image/image"

export namespace KiloAttachment {
  /**
   * Attachments with an `image/*` mime that Photon (our raster decoder) cannot
   * decode must never reach `Image.normalize` -- doing so turns a harmless
   * attachment like an SVG icon into a fatal `ImageDecodeError` that kills the
   * whole prompt before the user's message is persisted. Classify the mime up
   * front so the prompt pipeline can route each kind correctly:
   *
   * - "raster": a bitmap format Photon can decode/resize (`isImageAttachment`).
   * - "markup": a text-based image format (currently just SVG) that should be
   *   attached as readable source instead of a binary image.
   * - "other": anything else (pdf, text files, etc), unaffected by this split.
   */
  export type Kind = "raster" | "markup" | "other"

  const MARKUP_MIMES = new Set(["image/svg+xml"])

  export function classify(mime: string): Kind {
    if (MARKUP_MIMES.has(mime)) return "markup"
    if (isImageAttachment(mime)) return "raster"
    return "other"
  }

  /**
   * Cheap, synchronous rejection for a `data:` URL raster attachment that is
   * not actually decodable, without touching Photon/WASM. Used at the HTTP
   * boundary so a bad attachment is rejected with a 400 *before* `prompt_async`
   * promises acceptance, instead of surfacing as an async `session.error`
   * after the client has already cleared its draft.
   *
   * Only validates "raster"-classified `data:` parts, which is everything that
   * can be checked without touching the filesystem. A `file://` attachment is
   * deliberately left to the prompt pipeline: reading it here would bypass the
   * `permission: "read"` prompt and the `KiloReadObject` binding that
   * `prompt.ts` performs, so it cannot be pre-validated at the HTTP boundary.
   *
   * Returns a human-readable rejection reason, or `undefined` when the
   * attachment looks fine.
   */
  export function precheck(part: { mime: string; url: string }): string | undefined {
    if (classify(part.mime) !== "raster") return undefined
    if (!part.url.startsWith("data:")) return undefined
    // `Image.normalize` only accepts base64 data URLs and fails any other form with
    // InvalidDataUrlError, which the prompt pipeline turns into a defect. Reject it here
    // instead so the caller gets a 400 rather than a lost message.
    if (!part.url.includes(";base64,")) return `${part.mime} attachment must be a base64 data URL`
    const base64 = part.url.slice(part.url.indexOf(";base64,") + ";base64,".length)
    const data = Buffer.from(base64, "base64")
    const canonical = data.toString("base64").replace(/=+$/, "") === base64.replace(/=+$/, "")
    if (canonical && Image.dimensions(part.mime, data)) return undefined
    return `${part.mime} attachment could not be decoded as a valid image`
  }
}
