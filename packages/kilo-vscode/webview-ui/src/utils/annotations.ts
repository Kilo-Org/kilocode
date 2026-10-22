import {
  type Annotation,
  type AnnotationAnchor,
  parseAnnotations,
  validAnnotation,
} from "../../../src/shared/annotations"
export {
  type Annotation,
  ANNOTATION_LIMIT,
  ANNOTATION_TEXT_LIMIT,
  ANNOTATION_COMMENT_LIMIT,
  ANNOTATION_AGGREGATE_LIMIT,
  parseAnnotations,
  validAnnotation,
} from "../../../src/shared/annotations"

export function newAnnotation(input: {
  sessionID: string
  messageID: string
  selectedText: string
  comment?: string
  anchor?: AnnotationAnchor
  now?: number
}): Annotation {
  const now = input.now ?? Date.now()
  return {
    id: crypto.randomUUID(),
    sessionID: input.sessionID,
    messageID: input.messageID,
    selectedText: input.selectedText.trim(),
    comment: (input.comment ?? "").trim(),
    ...(input.anchor ? { anchor: input.anchor } : {}),
    createdAt: now,
    updatedAt: now,
  }
}

export function withAnnotationComment(item: Annotation, comment: string, now = Date.now()): Annotation {
  return { ...item, comment: comment.trim(), updatedAt: Math.max(now, item.updatedAt + 1) }
}

export function upsertAnnotation(items: readonly Annotation[], item: Annotation): Annotation[] {
  if (!validAnnotation(item)) return [...items]
  const index = items.findIndex((candidate) => candidate.id === item.id)
  const next = [...items]
  if (index < 0) next.push(item)
  else next[index] = item
  return parseAnnotations(next) ?? [...items]
}

export function removeAnnotation(items: readonly Annotation[], id: string): Annotation[] {
  return items.filter((item) => item.id !== id)
}

function fenceFor(value: string): string {
  const longest = (value.match(/`+/g) ?? []).reduce((max, item) => Math.max(max, item.length), 0)
  return "`".repeat(Math.max(3, longest + 1))
}

export function formatAnnotationsMarkdown(items: readonly Annotation[]): string {
  const annotations = parseAnnotations(items)
  if (!annotations) return ""
  const lines = ["## Annotations on previous responses", ""]
  for (const item of annotations) {
    const fence = fenceFor(item.selectedText)
    lines.push(
      `Comment${item.number === undefined ? "" : ` #${item.number}`} on selected text (${item.number === undefined ? "" : `source conversation ${item.sessionID}, `}message ${item.messageID}):`,
      fence,
      item.selectedText,
      fence,
      item.comment,
      "",
    )
  }
  return lines.join("\n").trimEnd()
}
