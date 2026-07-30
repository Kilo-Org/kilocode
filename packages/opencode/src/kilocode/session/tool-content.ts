import type { LlmToolContent } from "@kilocode/sdk/v2"

/**
 * Released Kilo installs persisted tool content as `{ type: "media", ... }` or
 * `{ type: "file", source: { ... } }`. Durable events replay those rows verbatim, so
 * consumers that store the current `LlmToolContent` shape must normalize first.
 */
export function normalizeToolContent(items: readonly unknown[]): LlmToolContent[] {
  return items.map((item) => {
    const value = item as Record<string, any>
    if (value.type === "media")
      return {
        type: "file" as const,
        uri: String(value.data).startsWith("data:") ? value.data : `data:${value.mediaType};base64,${value.data}`,
        mime: value.mediaType,
        ...(value.filename === undefined ? {} : { name: value.filename }),
      }
    if (value.type === "file" && value.source !== undefined) {
      const source = value.source
      return {
        type: "file" as const,
        uri:
          source.type === "data"
            ? `data:${value.mime};base64,${source.data}`
            : source.type === "url"
              ? source.url
              : source.uri,
        mime: value.mime,
        ...(value.name === undefined ? {} : { name: value.name }),
      }
    }
    return value
  }) as LlmToolContent[]
}
