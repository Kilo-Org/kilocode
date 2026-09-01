import { createSignal, onCleanup, type Accessor } from "solid-js"
import type { PermissionFileDiff } from "../src/types/messages"
import type { DiffStyle } from "../src/context/diff-style"
import { LOCAL } from "./navigate"

export interface EditPreview {
  diff: PermissionFileDiff
  sessionID?: string
  style: "unified" | "split"
  markdown: boolean
}

interface SessionLike {
  id: string
  parentID?: string | null
}

interface ManagedLike {
  id: string
  worktreeId?: string | null
}

export function sessionTreeContains(id: string, root: string, sessions: SessionLike[]): boolean {
  const seen = new Set<string>()
  let current: string | undefined = id
  while (current && !seen.has(current)) {
    if (current === root) return true
    seen.add(current)
    current = sessions.find((item) => item.id === current)?.parentID ?? undefined
  }
  return false
}

export function sessionWorktree(id: string, sessions: SessionLike[], managed: ManagedLike[]): string | undefined {
  const seen = new Set<string>()
  let current: string | undefined = id
  while (current && !seen.has(current)) {
    const worktree = managed.find((item) => item.id === current)?.worktreeId
    if (worktree) return worktree
    seen.add(current)
    current = sessions.find((item) => item.id === current)?.parentID ?? undefined
  }
  return undefined
}

export function diffCounts(
  diff: Pick<PermissionFileDiff, "additions" | "deletions">,
  hunks: Array<{ additionLines: number; deletionLines: number }>,
  status?: PermissionFileDiff["status"],
) {
  const additions = hunks.reduce((sum, hunk) => sum + hunk.additionLines, 0)
  const deletions = hunks.reduce((sum, hunk) => sum + hunk.deletionLines, 0)
  return {
    additions: status === "added" && diff.additions === 0 ? additions : diff.additions,
    deletions: status === "deleted" && diff.deletions === 0 ? deletions : diff.deletions,
  }
}

export function previewMatchesContext(
  previewSessionID: string | undefined,
  currentSessionID: string | null | undefined,
  selection: string | null | undefined,
  worktreeID: string | undefined,
  related?: (previewSessionID: string, currentSessionID: string) => boolean,
): boolean {
  if (!previewSessionID || !currentSessionID) return false
  if (previewSessionID !== currentSessionID && !related?.(previewSessionID, currentSessionID)) return false
  if (worktreeID) return worktreeID === selection
  return selection === LOCAL || selection === null
}

interface Options {
  show: () => void
  hide: () => void
  context?: Accessor<string | undefined>
  matches?: (sessionID: string | undefined) => boolean
  style?: Accessor<DiffStyle>
  onStyleChange?: (style: DiffStyle) => void
}

export function createEditPreview(opts: Options) {
  const [previews, setPreviews] = createSignal<Record<string, EditPreview | undefined>>({})
  const key = () => (opts.context ? opts.context() : "default")
  const preview = () => {
    const scope = key()
    const item = scope === undefined ? undefined : previews()[scope]
    return item && opts.matches?.(item.sessionID) !== false ? item : undefined
  }

  const open = (diff: PermissionFileDiff, sessionID?: string, style?: DiffStyle) => {
    const scope = key()
    if (scope === undefined || opts.matches?.(sessionID) === false) return
    setPreviews((prev) => ({
      ...prev,
      [scope]: { diff, sessionID, style: style ?? opts.style?.() ?? "unified", markdown: false },
    }))
    opts.show()
  }

  const update = (patch: Partial<Pick<EditPreview, "style" | "markdown">>) => {
    const scope = key()
    if (scope === undefined) return
    setPreviews((prev) => {
      const item = prev[scope]
      return item ? { ...prev, [scope]: { ...item, ...patch } } : prev
    })
  }
  const updateStyle = (style: "unified" | "split") => {
    update({ style })
    opts.onStyleChange?.(style)
  }

  const updateMarkdown = (markdown: boolean) => update({ markdown })

  const close = () => {
    const scope = key()
    if (scope === undefined) return
    setPreviews((prev) => ({ ...prev, [scope]: undefined }))
    opts.hide()
  }

  return { preview, open, updateStyle, updateMarkdown, close }
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

export function createAgentManagerEditPreview(opts: Options) {
  const state = createEditPreview(opts)
  onCleanup(attachEditPreviewEvent(state.open))
  return state
}
