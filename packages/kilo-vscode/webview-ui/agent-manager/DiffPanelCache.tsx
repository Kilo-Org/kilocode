import { For, createEffect, createMemo, createSignal, type Accessor, type Component, type JSX } from "solid-js"
import type { WorktreeFileDiff } from "../src/types/messages"
import type { ReviewComment } from "../diff-viewer/review-comments"
import type { ReviewComposer } from "../diff-viewer/review-annotations"
import { DiffPanel } from "./DiffPanel"
import { diffDataKey } from "./worktree-diffs"

const CACHE_SIZE = 4

interface Entry {
  key: string
  cacheKey: string
  ctx: string
  used: number
}

interface Props {
  current: Accessor<string | undefined>
  context: Accessor<string | undefined>
  project: Accessor<string | undefined>
  active: Accessor<boolean>
  onEvict?: (key: string) => void
  contexts: Accessor<Set<string>>
  data: Accessor<Record<string, WorktreeFileDiff[]>>
  loading: (key: string) => boolean
  loadingFiles: (key: string) => Set<string>
  notice: (key: string) => string | undefined
  comments: (ctx: string) => ReviewComment[]
  setComments: (ctx: string, comments: ReviewComment[]) => void
  composer: (key: string) => ReviewComposer
  lead: () => JSX.Element
  canRevert: boolean
  diffStyle: "unified" | "split"
  onDiffStyleChange: (style: "unified" | "split") => void
  markdownRender: boolean
  onMarkdownRenderChange: (render: boolean) => void
  onSendClick: () => void
  onClose: () => void
  onExpand?: () => void
  onRequestDiff: (key: string, file: string) => void
  onRequestDiffs: (key: string, files: string[]) => void
  onOpenFile: (ctx: string, file: string, line?: number) => void
  onOpenDocument: (file: string) => void
  onRevertFile: (key: string, ctx: string, file: string) => void
  revertingFiles: (key: string) => Set<string>
  activeTerminalId?: string
}

export const DiffPanelCache: Component<Props> = (props) => {
  const [entries, setEntries] = createSignal<Entry[]>([])
  let used = 0

  createEffect(() => {
    const contexts = props.contexts()
    setEntries((prev) => {
      const next = prev.filter((entry) => entry.ctx === "local" || contexts.has(entry.ctx))
      for (const item of prev) if (!next.includes(item)) props.onEvict?.(item.cacheKey)
      return next
    })
  })

  createEffect(() => {
    if (!props.active()) return
    const key = props.current()
    const ctx = props.context()
    const project = props.project() ?? "single"
    if (!key || !ctx) return
    const cacheKey = `${project}\0${key}`
    setEntries((prev) => {
      const prefix = `${project}\0`
      const scoped = prev.filter((item) => item.cacheKey.startsWith(prefix))
      const current = scoped.find((item) => item.cacheKey === cacheKey)
      if (current) {
        current.used = ++used
        for (const item of prev) if (!scoped.includes(item)) props.onEvict?.(item.cacheKey)
        return scoped
      }
      const next = [...scoped, { key, cacheKey, ctx, used: ++used }]
      if (next.length <= CACHE_SIZE) {
        for (const item of prev) if (!next.includes(item)) props.onEvict?.(item.cacheKey)
        return next
      }
      const oldest = next.reduce((entry, item) => (item.used < entry.used ? item : entry))
      const result = next.filter((item) => item !== oldest)
      props.onEvict?.(oldest.cacheKey)
      for (const item of prev) if (!result.includes(item)) props.onEvict?.(item.cacheKey)
      return result
    })
  })

  return (
    <For each={entries()}>
      {(entry) => {
        const active = createMemo(
          () => props.active() && `${props.project() ?? "single"}\0${props.current()}` === entry.cacheKey,
        )
        return (
          <div class="am-diff-panel-cache" classList={{ "am-diff-panel-cache-active": active() }} inert={!active()}>
            <DiffPanel
              diffs={props.data()[diffDataKey(props.project(), entry.key)] ?? []}
              loading={props.loading(entry.key)}
              active={active()}
              loadingFiles={props.loadingFiles(entry.key)}
              sessionKey={entry.key}
              notice={props.notice(entry.key)}
              lead={active() ? props.lead() : undefined}
              canRevert={props.canRevert}
              diffStyle={props.diffStyle}
              onDiffStyleChange={props.onDiffStyleChange}
              markdownRender={props.markdownRender}
              onMarkdownRenderChange={props.onMarkdownRenderChange}
              comments={props.comments(entry.key)}
              onCommentsChange={(comments) => props.setComments(entry.key, comments)}
              composer={props.composer(entry.cacheKey)}
              onSendClick={props.onSendClick}
              onClose={props.onClose}
              onExpand={props.onExpand}
              onRequestDiff={(file) => props.onRequestDiff(entry.key, file)}
              onRequestDiffs={(files) => props.onRequestDiffs(entry.key, files)}
              onOpenFile={(file, line) => props.onOpenFile(entry.ctx, file, line)}
              onOpenDocument={props.onOpenDocument}
              onRevertFile={(file) => props.onRevertFile(entry.key, entry.ctx, file)}
              revertingFiles={props.revertingFiles(entry.key)}
              activeTerminalId={props.activeTerminalId}
            />
          </div>
        )
      }}
    </For>
  )
}
