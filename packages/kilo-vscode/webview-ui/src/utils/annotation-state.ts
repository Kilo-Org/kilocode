import { type Accessor, createEffect, createSignal, on, untrack } from "solid-js"
import { type Annotation, upsertAnnotation, validAnnotation, withAnnotationComment } from "./annotations"

export interface AnnotationEditorDraft {
  annotation: Annotation
  comment: string
}

export interface AnnotationEditorState extends AnnotationEditorDraft {
  rect: DOMRect
}

export type AnnotationCommit =
  | { status: "none"; annotations: Annotation[] }
  | { status: "invalid"; annotations: Annotation[] }
  | { status: "rejected"; annotations: Annotation[] }
  | { status: "committed"; annotations: Annotation[] }

export function openAnnotationEditor(annotation: Annotation, rect: DOMRect): AnnotationEditorState {
  return { annotation, rect, comment: annotation.comment }
}

export function updateAnnotationEditor(
  current: AnnotationEditorState | undefined,
  annotationID: string,
  comment: string,
): AnnotationEditorState | undefined {
  if (!current || current.annotation.id !== annotationID) return current
  return { ...current, comment }
}

export function commitAnnotationEditor(
  current: AnnotationEditorState | undefined,
  annotations: readonly Annotation[],
  now = Date.now(),
): AnnotationCommit {
  if (!current) return { status: "none", annotations: [...annotations] }
  if (!current.comment.trim()) return { status: "invalid", annotations: [...annotations] }
  const annotation = withAnnotationComment(current.annotation, current.comment, now)
  if (!validAnnotation(annotation)) return { status: "rejected", annotations: [...annotations] }
  const next = upsertAnnotation(annotations, annotation)
  const saved = next.find((item) => item.id === annotation.id)
  if (!saved || saved.comment !== annotation.comment || saved.updatedAt !== annotation.updatedAt)
    return { status: "rejected", annotations: [...annotations] }
  return { status: "committed", annotations: next }
}

export function annotationFocusOutside(root: Node | undefined, target: Node | null): boolean {
  return !!target && !root?.contains(target)
}

export function annotationDraftPending(
  annotations: readonly Annotation[],
  editor: AnnotationEditorState | undefined,
): boolean {
  return annotations.length > 0 || editor !== undefined
}

export function annotationAutoSendAllowed(
  annotations: readonly Annotation[],
  editor: AnnotationEditorState | undefined,
): boolean {
  return !annotationDraftPending(annotations, editor)
}

export function annotationCommandBlocked(
  command: unknown,
  annotations: readonly Annotation[],
  editor: AnnotationEditorState | undefined,
): boolean {
  return !!command && !annotationAutoSendAllowed(annotations, editor)
}

export interface AnnotationSendToken {
  key: string
  sessionID: string | undefined
}

export function createAnnotationSendLock() {
  const [token, setToken] = createSignal<AnnotationSendToken>()
  const begin = (scope: AnnotationSendToken) => {
    if (token()) return undefined
    setToken(scope)
    return scope
  }
  const end = (scope: AnnotationSendToken) => {
    if (token() === scope) setToken(undefined)
  }
  const cancel = (key: string) => {
    if (token()?.key === key) setToken(undefined)
  }
  const held = (scope: AnnotationSendToken) => token() === scope
  const locked = (key: string) => token()?.key === key
  const run = (key: string, change: () => void) => {
    if (locked(key)) return false
    change()
    return true
  }
  return { active: () => token() !== undefined, begin, cancel, end, held, locked, run }
}

export function annotationSendOwns(scope: AnnotationSendToken, key: string, sessionID: string | undefined): boolean {
  return scope.key === key && scope.sessionID === sessionID
}

export function clearAcceptedAnnotationDraft(
  key: string,
  drafts: Map<string, Annotation[]>,
  editors: Map<string, AnnotationEditorDraft>,
) {
  drafts.delete(key)
  editors.delete(key)
}

export function replaceAnnotationDraft(input: {
  target: string
  current: string
  drafts: Map<string, Annotation[]>
  editors: Map<string, AnnotationEditorDraft>
  clearCurrent: () => void
}): boolean {
  input.drafts.delete(input.target)
  input.editors.delete(input.target)
  if (input.target !== input.current) return false
  input.clearCurrent()
  return true
}

function visibleFocusTarget(target: HTMLElement | undefined): target is HTMLElement {
  return !!target?.isConnected && !target.closest("[hidden]")
}

export function annotationFocusTarget(
  primary: HTMLElement | undefined,
  fallback: HTMLElement | undefined,
): HTMLElement | undefined {
  if (visibleFocusTarget(primary)) return primary
  if (visibleFocusTarget(fallback)) return fallback
  return undefined
}

export function createAnnotationEditorDraftState(input: {
  key: Accessor<string>
  drafts: Map<string, AnnotationEditorDraft>
  rect: (annotation: Annotation) => DOMRect
}) {
  const [editor, setEditor] = createSignal<AnnotationEditorState>()
  let editorKey = input.key()
  const persist = (key: string, current = untrack(editor)) => {
    if (current) input.drafts.set(key, { annotation: current.annotation, comment: current.comment })
    else input.drafts.delete(key)
  }
  const load = (key = input.key()) => {
    const draft = input.drafts.get(key)
    editorKey = key
    setEditor(draft ? { ...draft, rect: input.rect(draft.annotation) } : undefined)
  }
  const replace = (current: AnnotationEditorState | undefined) => {
    editorKey = input.key()
    setEditor(current)
    persist(editorKey, current)
  }
  const commit = (annotations: readonly Annotation[], now?: number) =>
    commitAnnotationEditor(editor(), annotations, now)
  const commitAndClose = (annotations: readonly Annotation[], now?: number) => {
    const result = commit(annotations, now)
    if (result.status === "committed") replace(undefined)
    return result
  }

  createEffect(
    on(input.key, (key, previous) => {
      if (previous !== undefined && previous !== key && editorKey === previous) persist(previous)
      load(key)
    }),
  )

  return {
    editor,
    replace,
    persist,
    load,
    snapshot: () => {
      const current = editor()
      return current ? { annotation: current.annotation, comment: current.comment } : undefined
    },
    commitAndClose,
  }
}
