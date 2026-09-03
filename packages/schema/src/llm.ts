export * as LLM from "./llm"

import { Schema, SchemaGetter } from "effect"
import { optional } from "./schema"

export const ProviderMetadata = Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown)).annotate({
  identifier: "LLM.ProviderMetadata",
})
export type ProviderMetadata = Schema.Schema.Type<typeof ProviderMetadata>

export interface ToolTextContent extends Schema.Schema.Type<typeof ToolTextContent> {}
export const ToolTextContent = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
}).annotate({ identifier: "Tool.TextContent" })

export interface ToolFileContent extends Schema.Schema.Type<typeof ToolFileContent> {}
export const ToolFileContent = Schema.Struct({
  type: Schema.Literal("file"),
  uri: Schema.String,
  mime: Schema.String,
  name: optional(Schema.String),
}).annotate({ identifier: "Tool.FileContent" })

export const ToolContent = Schema.Union([ToolTextContent, ToolFileContent])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "LLM.ToolContent" })
export type ToolContent = Schema.Schema.Type<typeof ToolContent>

// kilocode_change start - durable events must keep decoding released tool content shapes
const LegacyToolFileContent = Schema.Struct({
  type: Schema.Literal("file"),
  source: Schema.Union([
    Schema.Struct({ type: Schema.Literal("data"), data: Schema.String }),
    Schema.Struct({ type: Schema.Literal("url"), url: Schema.String }),
    Schema.Struct({ type: Schema.Literal("file"), uri: Schema.String }),
  ]).pipe(Schema.toTaggedUnion("type")),
  mime: Schema.String,
  name: optional(Schema.String),
})
const LegacyToolMediaContent = Schema.Struct({
  type: Schema.Literal("media"),
  mediaType: Schema.String,
  data: Schema.String,
  filename: optional(Schema.String),
})
const ToolContentInput = Schema.Union([ToolContent, LegacyToolFileContent, LegacyToolMediaContent])

/** Encodes current tool content back into the released persisted shape. */
const stored = (item: ToolContent): typeof ToolContentInput.Type => {
  if (item.type === "text") return item
  const data = /^data:[^;,]+;base64,(.*)$/s.exec(item.uri)?.[1]
  const source = data
    ? ({ type: "data", data } as const)
    : URL.canParse(item.uri) && ["http:", "https:"].includes(new URL(item.uri).protocol)
      ? ({ type: "url", url: item.uri } as const)
      : ({ type: "file", uri: item.uri } as const)
  return { type: "file", source, mime: item.mime, name: item.name }
}

/** Decodes released and current persisted tool content into the current `ToolContent` shape. */
export const StoredToolContent = ToolContentInput.pipe(
  Schema.decodeTo(ToolContent, {
    decode: SchemaGetter.transform((item) => {
      if (item.type === "text" || (item.type === "file" && "uri" in item)) return item
      if (item.type === "media")
        return {
          type: "file" as const,
          uri: item.data.startsWith("data:") ? item.data : `data:${item.mediaType};base64,${item.data}`,
          mime: item.mediaType,
          name: item.filename,
        }
      const source = item.source
      const uri =
        source.type === "data"
          ? `data:${item.mime};base64,${source.data}`
          : source.type === "url"
            ? source.url
            : source.uri
      return { type: "file" as const, uri, mime: item.mime, name: item.name }
    }),
    encode: SchemaGetter.transform(stored),
  }),
).annotate({ identifier: "LLM.StoredToolContent" })
// kilocode_change end
