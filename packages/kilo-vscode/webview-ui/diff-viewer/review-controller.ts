import { createEffect, createMemo, createRenderEffect, createSignal, on, untrack, type Accessor } from "solid-js"
import type { DiffLineAnnotation, AnnotationSide, SelectedLineRange } from "@pierre/diffs"
import type { UiI18nParams } from "@kilocode/kilo-ui/context"
import type { WorktreeFileDiff } from "../src/types/messages"
import { lineCount, sanitizeReviewComments, type ReviewComment } from "./review-comments"
import {
  buildFileAnnotations,
  buildReviewAnnotation,
  clearReviewComposer,
  reviewComposerDraft,
  reviewComposerEdit,
  reviewDraftSpeechKey,
  reviewEditSpeechKey,
  sendReviewComments,
  labels,
  type AnnotationMeta,
  type ReviewComposer,
} from "./review-annotations"
import { createReviewAnnotationSpeechRenderer } from "./review-annotation-speech"
import { createReviewSpeech } from "./review-setup"

type Props = {
  diffs: Accessor<WorktreeFileDiff[]>
  rows: Accessor<WorktreeFileDiff[]>
  comments: Accessor<ReviewComment[]>
  setComments: (comments: ReviewComment[]) => void
  composer: () => ReviewComposer
  key: Accessor<string | undefined>
  preserveScroll: (run: () => void) => void
  focus: () => void
  label: (key: string, params?: UiI18nParams) => string
  activeTerminalId: Accessor<string | undefined>
  active?: Accessor<boolean>
  canComment?: Accessor<boolean>
  onSendClick?: () => void
  onSendAll?: () => void
}

export function createReviewController(props: Props) {
  const active = props.active ?? (() => true)
  const canComment = props.canComment ?? (() => true)
  const [draft, setDraft] = createSignal(reviewComposerDraft(props.composer()))
  const [editing, setEditing] = createSignal(reviewComposerEdit(props.composer()))
  const [speechKeys, setSpeechKeys] = createSignal(new Set<string>())
  const voice = createReviewSpeech(props.label)
  const speech = createReviewAnnotationSpeechRenderer({
    speech: voice.speech,
    enabled: voice.enabled,
    model: voice.model,
    label: props.label,
    keys: speechKeys,
  })
  let nextId = 0
  let draftMeta: AnnotationMeta | null = props.composer().draft
  let editMeta: AnnotationMeta | null = props.composer().edit

  createEffect(
    on(
      () => [draft(), editing()] as const,
      ([current, edit]) => {
        const keys = new Set<string>()
        if (current) keys.add(reviewDraftSpeechKey(current))
        if (edit) keys.add(reviewEditSpeechKey(edit))
        setSpeechKeys(keys)
      },
    ),
  )

  createRenderEffect(
    on(active, (value) => {
      if (!value) return
      const current = reviewComposerDraft(props.composer())
      const edit = reviewComposerEdit(props.composer())
      setDraft(current)
      setEditing(edit)
      draftMeta = props.composer().draft
      editMeta = props.composer().edit
    }),
  )

  createEffect(
    on(
      props.key,
      () => {
        if (!active()) return
        setDraft(null)
        draftMeta = null
        setEditing(null)
        editMeta = null
        clearReviewComposer(props.composer())
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => [props.diffs(), props.comments()] as const,
      ([diffs, current]) => {
        if (!active()) return
        const valid = sanitizeReviewComments(current, diffs)
        if (valid.length !== current.length) props.setComments(valid)

        const edit = editing()
        if (edit && !valid.some((comment) => comment.id === edit)) {
          setEditing(null)
          editMeta = null
          props.composer().edit = null
        }

        const currentDraft = draft()
        if (!currentDraft) return
        const diff = diffs.find((item) => item.file === currentDraft.file)
        if (!diff) return cancelDraft()
        const max = lineCount(currentDraft.side === "deletions" ? diff.before : diff.after)
        if (
          currentDraft.line < 1 ||
          currentDraft.line > max ||
          (currentDraft.endLine !== undefined && currentDraft.endLine > max)
        ) {
          cancelDraft()
        }
      },
    ),
  )

  const commentsByFile = createMemo(() => {
    const map = new Map<string, ReviewComment[]>()
    for (const comment of props.comments()) {
      const list = map.get(comment.file) ?? []
      list.push(comment)
      map.set(comment.file, list)
    }
    return map
  })

  const pinned = createMemo(() => {
    const files = new Set<string>()
    const current = draft()
    if (current) files.add(current.file)
    const edit = editing()
    if (edit) {
      const comment = props.comments().find((item) => item.id === edit)
      if (comment) files.add(comment.file)
    }
    return props.rows().flatMap((diff, index) => (files.has(diff.file) ? [index] : []))
  })

  const cancelDraft = () => {
    props.preserveScroll(() => {
      setDraft(null)
      draftMeta = null
      props.composer().draft = null
    })
    props.focus()
  }

  const addComment = (file: string, side: AnnotationSide, line: number, text: string, selectedText: string) => {
    props.preserveScroll(() => {
      const id = `c-${++nextId}-${Date.now()}`
      props.setComments([...props.comments(), { id, file, side, line, comment: text, selectedText }])
      setDraft(null)
      draftMeta = null
      props.composer().draft = null
    })
    props.focus()
  }

  const sendComment = (file: string, side: AnnotationSide, line: number, text: string, selectedText: string) => {
    const comment = { id: `c-${++nextId}-${Date.now()}`, file, side, line, comment: text, selectedText }
    sendReviewComments([comment], props.activeTerminalId())
    props.preserveScroll(() => {
      setDraft(null)
      draftMeta = null
      props.composer().draft = null
    })
    props.onSendClick?.()
    props.focus()
  }

  const updateComment = (id: string, text: string) => {
    props.preserveScroll(() => {
      props.setComments(
        props.comments().map((comment) => (comment.id === id ? { ...comment, comment: text } : comment)),
      )
      setEditing(null)
      editMeta = null
      props.composer().edit = null
    })
    props.focus()
  }

  const deleteComment = (id: string) => {
    props.preserveScroll(() => {
      props.setComments(props.comments().filter((comment) => comment.id !== id))
      if (editing() === id) {
        setEditing(null)
        editMeta = null
        props.composer().edit = null
      }
    })
    props.focus()
  }

  const setEditState = (id: string | null) => {
    if (editing() !== id) {
      editMeta = null
      props.composer().edit = null
    }
    props.preserveScroll(() => setEditing(id))
    if (id === null) props.focus()
  }

  const annotationsForFile = (file: string): DiffLineAnnotation<AnnotationMeta>[] => {
    const result = buildFileAnnotations(file, commentsByFile().get(file) ?? [], editing(), draft(), draftMeta, editMeta)
    draftMeta = result.draftMeta
    editMeta = result.editMeta
    if (untrack(() => active())) {
      props.composer().draft = draft() ? draftMeta : null
      props.composer().edit = editing() ? editMeta : null
    }
    return result.annotations
  }

  const buildAnnotation = (annotation: DiffLineAnnotation<AnnotationMeta>): HTMLElement | undefined =>
    buildReviewAnnotation(annotation, {
      diffs: props.diffs(),
      editing: editing(),
      setEditing: setEditState,
      addComment,
      sendComment,
      updateComment,
      deleteComment,
      cancelDraft,
      labels: labels(props.label),
      activeTerminalId: props.activeTerminalId,
      speech,
    })

  const handleGutterClick = (file: string, range: SelectedLineRange) => {
    if (!canComment() || draft()) return
    const side: AnnotationSide = range.side === "deletions" ? "deletions" : "additions"
    props.preserveScroll(() => {
      const next = { file, side, line: range.start, endLine: range.end }
      draftMeta = { type: "draft", comment: null, ...next }
      props.composer().draft = draftMeta
      setDraft(next)
    })
  }

  const sendAllToChat = () => {
    const comments = props.comments()
    if (comments.length === 0) return
    sendReviewComments(comments, props.activeTerminalId())
    props.preserveScroll(() => props.setComments([]))
    props.onSendAll?.()
  }

  const sendAllClick = () => {
    props.onSendClick?.()
    sendAllToChat()
  }

  return {
    pinned,
    commentsByFile,
    annotationsForFile,
    buildAnnotation,
    cancelDraft,
    addComment,
    sendComment,
    updateComment,
    deleteComment,
    setEditState,
    handleGutterClick,
    sendAllToChat,
    sendAllClick,
  }
}
