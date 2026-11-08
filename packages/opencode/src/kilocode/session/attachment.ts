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
   * Relabels a markup "image" (SVG) as `text/plain` so the prompt pipeline treats it as the
   * source text it is. Applied once before parts are resolved, which means the existing
   * `text/plain` paths do the reading and size limiting, and `message-v2` never forwards the
   * persisted part to the model as an `image/svg+xml` file part -- a mime providers reject, and
   * one that would be replayed on every later turn because the user message is saved.
   */
  export function asText<T extends { type: string; mime?: string }>(part: T): T {
    if (part.type !== "file" || !part.mime) return part
    return classify(part.mime) === "markup" ? { ...part, mime: "text/plain" } : part
  }

  /**
   * Cheap, synchronous rejection for a `data:` URL attachment the prompt
   * pipeline would only be able to reject as a defect. Used at the HTTP
   * boundary so a bad attachment is rejected with a 400 *before* `prompt_async`
   * promises acceptance, instead of surfacing as an async `session.error`
   * after the client has already cleared its draft.
   *
   * Only `data:` parts are checked, which is everything that can be validated
   * without touching the filesystem. A `file://` attachment is deliberately
   * left to the prompt pipeline: reading it here would bypass the
   * `permission: "read"` prompt and the `KiloReadObject` binding that
   * `prompt.ts` performs, so it cannot be pre-validated at the HTTP boundary.
   *
   * That leaves one known residual: a `file://` part carrying a raster mime
   * still reaches `image.normalize`, and an undecodable one becomes a defect
   * that `prompt_async` can only report after it has already acknowledged with
   * 204. No first-party client constructs that combination -- the VS Code
   * webview tags every `file://` mention `text/plain`, and the JetBrains client
   * inlines raster attachments as base64 `data:` URLs -- and tool-issued
   * attachments (read/webfetch/send_file) go through the tolerant
   * `processor.ts` path instead. So it is reachable only by a direct SDK or API
   * caller, which is what the oversized-image case in `httpapi-sdk.test.ts`
   * exercises against the synchronous route.
   *
   * Returns a human-readable rejection reason, or `undefined` when the
   * attachment looks fine.
   */
  export function precheck(part: { mime: string; url: string }): string | undefined {
    if (!part.url.startsWith("data:")) return undefined

    // A non-base64 `data:` URL is percent-encoded, and `decodeDataUrl` runs it through
    // `decodeURIComponent`, which throws `URIError` on a malformed escape. That throw would
    // become a defect and lose the message, so reject it here for every mime -- a markup
    // (SVG) part reaches the same decode even though it is not a raster.
    if (!part.url.includes(";base64,")) {
      const body = part.url.slice(part.url.indexOf(",") + 1)
      try {
        decodeURIComponent(body)
      } catch {
        return `${part.mime} attachment is not a decodable data URL`
      }
      // `Image.normalize` accepts base64 data URLs only and fails any other form with
      // InvalidDataUrlError, which the prompt pipeline turns into a defect.
      if (classify(part.mime) === "raster") return `${part.mime} attachment must be a base64 data URL`
      return undefined
    }

    if (classify(part.mime) !== "raster") return undefined
    const base64 = part.url.slice(part.url.indexOf(";base64,") + ";base64,".length)
    const data = Buffer.from(base64, "base64")
    if (data.byteLength === 0) return `${part.mime} attachment could not be decoded as a valid image`
    // Judge decodability by content, the same way Photon does, using the predicate shared with
    // `Image.fallback`. Single-sourcing it keeps this boundary check and the pipeline from
    // drifting apart: anything accepted here must also survive `Image.normalize`, otherwise an
    // attachment waved through would later die as a defect and lose the message. It still
    // rejects BMP bytes, which Photon traps on.
    if (Image.decodable(part.mime, data)) return undefined
    return `${part.mime} attachment could not be decoded as a valid image`
  }
}
