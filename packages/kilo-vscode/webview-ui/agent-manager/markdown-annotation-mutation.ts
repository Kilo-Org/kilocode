const selector = ".am-markdown-inline-annotations, .am-markdown-list-annotation, .am-markdown-table-annotation"

// Keep host insertion observable, only nested annotation UI updates are safe to ignore.
export function isAnnotationMutation(mutation: Pick<MutationRecord, "target">): boolean {
  const target = mutation.target
  if (!("closest" in target)) return false
  if (typeof target.closest !== "function") return false
  return target.closest(selector) !== null
}

export function annotationSelector(): string {
  return selector
}
