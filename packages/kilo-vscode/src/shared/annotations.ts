export const ANNOTATION_LIMIT = 100
export const ANNOTATION_TEXT_LIMIT = 2_000
export const ANNOTATION_COMMENT_LIMIT = 100_000
export const ANNOTATION_AGGREGATE_LIMIT = 1_000_000

export interface AnnotationAnchor {
  start: number
  end: number
  quote: string
  prefix: string
  suffix: string
  length: number
  digest: string
}

export interface Annotation {
  id: string
  sessionID: string
  messageID: string
  number?: number
  anchor?: AnnotationAnchor
  selectedText: string
  comment: string
  createdAt: number
  updatedAt: number
}

const integer = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
const id = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 512

function anchor(value: unknown): value is AnnotationAnchor {
  if (!value || typeof value !== "object") return false
  const item = value as AnnotationAnchor
  return (
    integer(item.start) &&
    integer(item.end) &&
    item.end > item.start &&
    integer(item.length) &&
    item.end <= item.length &&
    item.length <= 2_000_000 &&
    typeof item.quote === "string" &&
    item.quote.length === item.end - item.start &&
    item.quote.length <= ANNOTATION_TEXT_LIMIT &&
    typeof item.prefix === "string" &&
    item.prefix.length <= 64 &&
    typeof item.suffix === "string" &&
    item.suffix.length <= 64 &&
    typeof item.digest === "string" &&
    /^[a-f0-9]{64}$/.test(item.digest)
  )
}

export function validAnnotation(value: unknown): value is Annotation {
  if (!value || typeof value !== "object") return false
  const item = value as Annotation
  return (
    id(item.id) &&
    id(item.sessionID) &&
    id(item.messageID) &&
    (item.number === undefined || (integer(item.number) && item.number > 0)) &&
    typeof item.selectedText === "string" &&
    item.selectedText.trim().length > 0 &&
    item.selectedText.length <= ANNOTATION_TEXT_LIMIT &&
    (item.anchor === undefined || (anchor(item.anchor) && item.anchor.quote.trim() === item.selectedText.trim())) &&
    typeof item.comment === "string" &&
    item.comment.length <= ANNOTATION_COMMENT_LIMIT &&
    integer(item.createdAt) &&
    integer(item.updatedAt)
  )
}

// Allowlist persisted fields. In particular, never round-trip resolved references or provider metadata.
export function copyAnnotation(item: Annotation): Annotation {
  return {
    id: item.id,
    sessionID: item.sessionID,
    messageID: item.messageID,
    ...(item.number === undefined ? {} : { number: item.number }),
    ...(item.anchor
      ? {
          anchor: {
            start: item.anchor.start,
            end: item.anchor.end,
            quote: item.anchor.quote,
            prefix: item.anchor.prefix,
            suffix: item.anchor.suffix,
            length: item.anchor.length,
            digest: item.anchor.digest,
          },
        }
      : {}),
    selectedText: item.selectedText,
    comment: item.comment,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }
}

export function parseAnnotations(value: unknown): Annotation[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > ANNOTATION_LIMIT || !value.every(validAnnotation))
    return
  const items = value.map(copyAnnotation)
  if (JSON.stringify(items).length > ANNOTATION_AGGREGATE_LIMIT) return
  return items
}

export type AnnotationRequest = { type: "annotationRequest"; requestID: string; sessionID: string } & (
  | { action: "load" }
  | { action: "save"; annotation: Annotation }
  | { action: "delete"; ids: string[] }
)

export type AnnotationReply =
  | { type: "annotationRecords"; requestID?: string; sessionID: string; revision: number; items: Annotation[] }
  | { type: "annotationError"; requestID?: string; sessionID: string; error: string }

export function validAnnotationRequest(value: unknown): value is AnnotationRequest {
  if (!value || typeof value !== "object") return false
  const item = value as AnnotationRequest
  if (item.type !== "annotationRequest" || !id(item.requestID) || !id(item.sessionID)) return false
  if (item.action === "load") return true
  if (item.action === "save") return validAnnotation(item.annotation) && item.annotation.sessionID === item.sessionID
  return (
    item.action === "delete" && Array.isArray(item.ids) && item.ids.length <= ANNOTATION_LIMIT && item.ids.every(id)
  )
}
