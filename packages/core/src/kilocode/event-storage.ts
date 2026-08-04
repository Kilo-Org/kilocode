// kilocode_change start - released readers persist tool content in the pre-1.17.13 shapes
//
// Kilo has shipped durable rows whose `content` uses `{type:"media"}` or `{type:"file",source}`.
// Before v1.17.13 the codec lived on the event schema, but upstream moved session events onto the
// wire (`SessionEvent.Durable` backs `/api/session/{id}/history`), so a schema-level transform now
// forks the generated OpenAPI surface into duplicate variants. Keyed on event type and applied only
// where rows enter and leave SQL, so the wire contract stays upstream's.
import { Schema } from "effect"
import { StoredToolContent } from "@opencode-ai/llm"

const decodeContent = Schema.decodeUnknownSync(Schema.Array(StoredToolContent))
const encodeContent = Schema.encodeUnknownSync(Schema.Array(StoredToolContent))

/** Durable event types carrying tool `content`. Unversioned, matching `Definition["type"]`. */
const CONTENT_TYPES = new Set(["session.next.tool.progress", "session.next.tool.success"])

const mapContent = (type: string, data: unknown, convert: (content: readonly unknown[]) => unknown) => {
  if (!CONTENT_TYPES.has(type)) return data
  if (typeof data !== "object" || data === null) return data
  const content = (data as { readonly content?: unknown }).content
  if (!Array.isArray(content)) return data
  return { ...(data as Record<string, unknown>), content: convert(content) }
}

/** Released or current persisted `data` -> the shape `definition.data` expects. */
export const decode = (type: string, data: unknown) => mapContent(type, data, (content) => decodeContent(content))

/** Encoded `definition.data` -> the persisted shape released readers still parse. */
export const encode = (type: string, data: unknown) => mapContent(type, data, (content) => encodeContent(content))
// kilocode_change end
