import type { ProviderMetadata } from "@opencode-ai/llm"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { Cause, Effect, Exit } from "effect"
import { Image } from "@/image/image"
import { KiloAttachment } from "@/kilocode/session/attachment"
import { isRecord } from "@/util/record"

/**
 * Images that a model generates inline (Gemini "Nano Banana", GPT image models, OpenRouter
 * `message.images`, ...) reach the AI SDK stream as `file` parts. The shared LLM event
 * contract has no file event, so the AI SDK adapter collects them per step and carries them
 * on the step-finish provider metadata. The processor then persists them as assistant
 * `file` parts, which clients render inline.
 */
export namespace KiloGeneratedFile {
  export type File = { mime: string; url: string }

  const EXT: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/svg+xml": "svg",
  }

  /** Build a renderable file from an AI SDK generated file. Non-image files are ignored. */
  export function from(file: { mediaType: string; base64: string }): File | undefined {
    const mime = file.mediaType.toLowerCase()
    if (!mime.startsWith("image/")) return
    const data = file.base64.trim()
    if (!data) return
    // Providers that return a hosted image URL instead of inline data hand it through as-is.
    if (/^https:\/\//i.test(data)) return { mime, url: data }
    if (/^data:/i.test(data)) return { mime, url: data }
    return { mime, url: `data:${mime};base64,${data}` }
  }

  export function write(metadata: ProviderMetadata | undefined, files: File[]) {
    if (files.length === 0) return metadata
    const kilo = isRecord(metadata?.kilo) ? metadata.kilo : {}
    return { ...metadata, kilo: { ...kilo, files: [...files] } }
  }

  export function read(metadata: ProviderMetadata | undefined): File[] {
    const kilo = metadata?.kilo
    if (!isRecord(kilo) || !Array.isArray(kilo.files)) return []
    return kilo.files.filter(
      (item): item is File => isRecord(item) && typeof item.mime === "string" && typeof item.url === "string",
    )
  }

  function name(mime: string, index: number) {
    const ext = EXT[mime] ?? mime.slice("image/".length).replace(/[^a-z0-9]/g, "")
    return `image-${index + 1}.${ext || "png"}`
  }

  /** Assistant file parts for the files carried on a step-finish event. */
  export function parts(
    metadata: ProviderMetadata | undefined,
    input: {
      sessionID: SessionV1.FilePart["sessionID"]
      messageID: SessionV1.FilePart["messageID"]
      id: () => SessionV1.FilePart["id"]
    },
  ): SessionV1.FilePart[] {
    return read(metadata).map((file, index) => ({
      id: input.id(),
      sessionID: input.sessionID,
      messageID: input.messageID,
      type: "file",
      mime: file.mime,
      url: file.url,
      filename: name(file.mime, index),
    }))
  }

  type Limits = { attachment?: { image?: { max_base64_bytes?: number } } }

  /**
   * Bound inline images like tool attachments before they reach the session store and every
   * part update: raster images go through `Image.normalize` (dimension and size limits), other
   * inline images are kept only under the configured base64 size limit. Hosted URLs are not
   * stored inline. Returns undefined when the image cannot be brought under the limits.
   */
  export const normalize = Effect.fn("KiloGeneratedFile.normalize")(function* (
    part: SessionV1.FilePart,
    image: Image.Interface,
    limit: number,
  ) {
    if (!/^data:/i.test(part.url)) return part
    if (KiloAttachment.classify(part.mime) !== "raster") {
      const data = part.url.slice(part.url.indexOf(",") + 1)
      return Buffer.byteLength(data, "utf8") <= limit ? part : undefined
    }
    return yield* image.normalize(part).pipe(
      Effect.catchIf(
        (error) => error instanceof Image.ResizerUnavailableError,
        () => Effect.succeed(part),
      ),
    )
  })

  /**
   * Parts to persist for the images carried on a step-finish event. Each image is normalized in
   * isolation, so a failure or defect only drops that image. Dropped images are logged and
   * reported to the user with a local notice that is not replayed to the model, matching the
   * tool-attachment path.
   */
  export const store = Effect.fn("KiloGeneratedFile.store")(function* (input: {
    metadata: ProviderMetadata | undefined
    sessionID: SessionV1.FilePart["sessionID"]
    messageID: SessionV1.FilePart["messageID"]
    id: () => SessionV1.FilePart["id"]
    image: Image.Interface
    config: Limits
  }) {
    const limit = input.config.attachment?.image?.max_base64_bytes ?? Image.MAX_BASE64_BYTES
    const files = parts(input.metadata, input)
    const results = yield* Effect.forEach(files, (part) =>
      normalize(part, input.image, limit).pipe(
        Effect.exit,
        Effect.map((exit) => ({ part, exit })),
      ),
    )
    const kept = results.flatMap((item) => (Exit.isSuccess(item.exit) && item.exit.value ? [item.exit.value] : []))
    const dropped = results.filter((item) => !Exit.isSuccess(item.exit) || !item.exit.value)
    if (dropped.length === 0) return kept
    yield* Effect.logWarning("generated images omitted", {
      sessionID: input.sessionID,
      messageID: input.messageID,
      parts: dropped.map((item) => item.part.id),
      causes: dropped.flatMap((item) => (Exit.isFailure(item.exit) ? [Cause.pretty(item.exit.cause)] : [])),
    })
    const notice: SessionV1.TextPart = {
      id: input.id(),
      sessionID: input.sessionID,
      messageID: input.messageID,
      type: "text",
      text: `[${dropped.length} generated image${dropped.length === 1 ? "" : "s"} omitted: could not be processed within the image size limit.]`,
      ignored: true,
    }
    return [...kept, notice]
  })
}
