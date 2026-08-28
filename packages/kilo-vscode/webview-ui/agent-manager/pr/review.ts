import { batch, createEffect, createSignal, on, onCleanup, type Accessor } from "solid-js"
import { thread } from "../../../src/shared/pr-review"
import type { PRReviewCommentData } from "../../../src/shared/review-comments"
import type { PRStatus } from "../../src/types/messages"
import { sessionTreeContains, sessionWorktree } from "../edit-preview"
import type { PRComment } from "./pr-types"

interface Options {
  context: Accessor<string | undefined>
  project: Accessor<string | undefined>
  current: Accessor<string | null | undefined>
  sessions: Accessor<Parameters<typeof sessionTreeContains>[2]>
  managed: Accessor<Parameters<typeof sessionWorktree>[2]>
  statuses: Accessor<Record<string, Pick<PRStatus, "comments"> | null>>
  select: (id: string) => void
  show: () => void
}

export function createPRReview(opts: Options) {
  const [target, setTarget] = createSignal<{
    key: string
    comment: PRComment
    focus: { id: string; file: string }
  }>()
  const key = (context?: string) => `${opts.project() ?? "single"}\0${context ?? ""}`
  const comments = (context = opts.context()): PRComment[] => {
    if (!context) return []
    const list = opts.statuses()[context]?.comments?.comments ?? []
    const item = target()
    if (!item || item.key !== key(`${context}#branch`)) return list
    if (list.some((comment) => comment.threadId === item.comment.threadId)) return list
    return [...list, { ...item.comment, outdated: true }]
  }
  const focus = (scope?: string) => {
    const item = target()
    return item?.key === key(scope) ? item.focus : undefined
  }
  const open = (comment: PRComment) => {
    const context = opts.context()
    if (!context || !comment.file) return false
    const current = opts.statuses()[context]?.comments?.comments.find((item) => item.threadId === comment.threadId)
    const value = current ?? comment
    if (!value.file) return false
    batch(() => {
      opts.select(`${context}#branch`)
      setTarget({ key: key(`${context}#branch`), comment: value, focus: { id: value.threadId, file: value.file! } })
      opts.show()
    })
    return true
  }
  const handle = (event: Event) => {
    const detail = (event as CustomEvent<{ comment?: PRReviewCommentData; sessionID?: string }>).detail
    if (!detail?.comment || detail.comment.origin !== "pr") return
    const id = detail.sessionID
    const current = opts.current()
    if (id && id !== current) {
      if (!current || !sessionTreeContains(id, current, opts.sessions())) return
    }
    const owner = id ? sessionWorktree(id, opts.sessions(), opts.managed()) : undefined
    if (owner && owner !== opts.context()) return
    if (open(thread(detail.comment))) event.preventDefault()
  }
  window.addEventListener("kilo:open-pr-comment", handle)
  onCleanup(() => window.removeEventListener("kilo:open-pr-comment", handle))
  createEffect(
    on(
      () => key(opts.context()),
      () => setTarget(undefined),
      { defer: true },
    ),
  )
  return { comments, focus, open }
}
