import { createEffect, createSignal, on, onCleanup, type Accessor } from "solid-js"
import type { PermissionFileDiff } from "../src/types/messages"
import type { DiffStyle } from "../src/context/diff-style"
import { LOCAL } from "./navigate"

export interface EditPreview {
  diff: PermissionFileDiff
  sessionID?: string
  style: "unified" | "split"
  markdown: boolean
}

export function previewMatchesContext(
  previewSessionID: string | undefined,
  currentSessionID: string | null | undefined,
  selection: string | null | undefined,
  worktreeID: string | undefined,
): boolean {
  if (!previewSessionID || previewSessionID !== currentSessionID) return false
  if (worktreeID) return worktreeID === selection
  return selection === LOCAL || selection === null
}

export function createEditPreviewContextGuard(
  preview: Accessor<EditPreview | undefined>,
  current: Accessor<string | null | undefined>,
  selection: Accessor<string | null | undefined>,
  owner: (sessionID: string) => string | undefined,
  close: () => void,
) {
  createEffect(
    on(
      () => {
        const item = preview()
        const worktree = item?.sessionID ? owner(item.sessionID) : undefined
        return `${item?.sessionID ?? ""}:${current() ?? ""}:${selection() ?? "unassigned"}:${worktree ?? "local"}`
      },
      () => {
        const item = preview()
        if (item && !previewMatchesContext(item.sessionID, current(), selection(), owner(item.sessionID!))) close()
      },
      { defer: true },
    ),
  )
}

interface Options {
  show: () => void
  hide: () => void
  style?: Accessor<DiffStyle>
  onStyleChange?: (style: DiffStyle) => void
}

export function createEditPreview(opts: Options) {
  const [preview, setPreview] = createSignal<EditPreview>()

  const open = (diff: PermissionFileDiff, sessionID?: string, style?: DiffStyle) => {
    setPreview({ diff, sessionID, style: style ?? opts.style?.() ?? "unified", markdown: false })
    opts.show()
  }

  const updateStyle = (style: "unified" | "split") => {
    setPreview((current) => (current ? { ...current, style } : current))
    opts.onStyleChange?.(style)
  }

  const updateMarkdown = (markdown: boolean) => {
    setPreview((current) => (current ? { ...current, markdown } : current))
  }

  const close = () => {
    setPreview(undefined)
    opts.hide()
  }

  return { preview: preview as Accessor<EditPreview | undefined>, open, updateStyle, updateMarkdown, close }
}

export function isEditPreviewDiff(value: unknown): value is PermissionFileDiff {
  if (!value || typeof value !== "object") return false
  const diff = value as Partial<PermissionFileDiff>
  return (
    typeof diff.file === "string" &&
    typeof diff.additions === "number" &&
    typeof diff.deletions === "number" &&
    (diff.patch === undefined || typeof diff.patch === "string") &&
    (diff.files === undefined ||
      (Array.isArray(diff.files) && diff.files.length > 0 && diff.files.every((file) => isEditPreviewDiff(file))))
  )
}

export function handleEditPreviewEvent(
  event: Event,
  open: (diff: PermissionFileDiff, sessionID?: string, style?: "unified" | "split") => void,
): void {
  const detail = (event as CustomEvent<{ diff?: unknown; sessionID?: unknown; initialDiffStyle?: unknown }>).detail
  if (!isEditPreviewDiff(detail?.diff)) return
  open(
    detail.diff,
    typeof detail.sessionID === "string" ? detail.sessionID : undefined,
    detail.initialDiffStyle === "split" ? "split" : "unified",
  )
}

export function attachEditPreviewEvent(
  open: (diff: PermissionFileDiff, sessionID?: string, style?: "unified" | "split") => void,
): () => void {
  const handler = (event: Event) => handleEditPreviewEvent(event, open)
  window.addEventListener("agentManager.openEditPreview", handler)
  return () => window.removeEventListener("agentManager.openEditPreview", handler)
}

export function createAgentManagerEditPreview(
  history: (value: boolean) => void,
  review: (value: boolean) => void,
  show: () => void,
  hide: () => void,
  style?: Accessor<DiffStyle>,
  onStyleChange?: (style: DiffStyle) => void,
) {
  const state = createEditPreview({
    show: () => {
      history(false)
      review(false)
      show()
    },
    hide,
    style,
    onStyleChange,
  })
  onCleanup(attachEditPreviewEvent(state.open))
  return state
}
