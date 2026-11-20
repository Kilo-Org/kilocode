import {
  For,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  untrack,
  type Accessor,
  type Component,
  type JSX,
} from "solid-js"
import type { WorktreeFileDiff } from "../src/types/messages/agent-manager"
import type { ReviewComment } from "../diff-viewer/review-comments"
import type { ReviewComposer } from "../diff-viewer/review-annotations"
import type { PRComment } from "./pr/pr-types"
import type { PRDiffSnapshot, PRTarget } from "../../src/shared/pr-comment-actions"
import { DiffPanel } from "./DiffPanel"
import { diffDataKey } from "./worktree-diffs"
import { ViewActiveProvider, blurOnHide, freezeValue, skipInactiveFocus } from "../src/v2/view-active"

const CACHE_SIZE = 16
/** Number of MRU diff panels kept warm in place (no content-visibility: hidden) for instant switching. */
const HOT_DIFF_SLOTS = 8

interface Entry {
  key: string
  cacheKey: string
  project: string
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
  remoteComments?: (ctx: string) => PRComment[]
  remoteTarget?: (ctx: string, comment: PRComment) => PRTarget | undefined
  prTarget?: (ctx: string) => PRTarget | undefined
  prSnapshot?: (ctx: string) => PRDiffSnapshot | undefined
  prLoading?: (ctx: string) => boolean
  prError?: (ctx: string) => string | undefined
  focusedComment?: (key: string) => { id: string; file: string } | undefined
  setComments: (ctx: string, comments: ReviewComment[]) => void
  composer: (key: string) => ReviewComposer
  lead: (active: Accessor<boolean>) => JSX.Element
  canRevert: boolean
  diffStyle: "unified" | "split"
  onDiffStyleChange: (style: "unified" | "split") => void
  markdownRender: boolean
  onMarkdownRenderChange: (render: boolean) => void
  onSendClick: () => void
  onClose: () => void
  onExpand?: () => void
  onRequestDiff: (key: string, file: string) => void
  onOpenFile: (ctx: string, file: string, line?: number) => void
  onOpenDocument?: (file: string) => void
  onRevertFile: (key: string, ctx: string, file: string) => void
  revertingFiles: (key: string) => Set<string>
  activeTerminalId?: string
}

function sameKeySet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false
  for (const key of a) if (!b.has(key)) return false
  return true
}

export const DiffPanelCache: Component<Props> = (props) => {
  const [entries, setEntries] = createSignal<Entry[]>([])
  const [coldKeys, setColdKeys] = createSignal<ReadonlySet<string>>(new Set())
  let used = 0
  let idleHandle: number | ReturnType<typeof setTimeout> | undefined

  const cancelIdle = () => {
    if (idleHandle === undefined) return
    if (typeof cancelIdleCallback === "function") cancelIdleCallback(idleHandle as number)
    else clearTimeout(idleHandle)
    idleHandle = undefined
  }

  const updateColdKeys = (next: ReadonlySet<string>) => {
    if (!sameKeySet(untrack(coldKeys), next)) setColdKeys(next)
  }

  const scheduleColdDemotion = () => {
    cancelIdle()
    const run = () => {
      idleHandle = undefined
      const list = entries()
      if (list.length <= HOT_DIFF_SLOTS) {
        updateColdKeys(new Set<string>())
        return
      }
      const hot = new Set(
        [...list]
          .sort((a, b) => b.used - a.used)
          .slice(0, HOT_DIFF_SLOTS)
          .map((item) => item.cacheKey),
      )
      const next = new Set<string>()
      for (const item of list) if (!hot.has(item.cacheKey)) next.add(item.cacheKey)
      updateColdKeys(next)
    }
    if (typeof requestIdleCallback === "function") idleHandle = requestIdleCallback(run, { timeout: 500 })
    else idleHandle = setTimeout(run, 150)
  }

  onCleanup(cancelIdle)

  createEffect(() => {
    const contexts = props.contexts()
    let pruned = false
    setEntries((prev) => {
      const next = prev.filter((entry) => entry.ctx === "local" || contexts.has(entry.ctx))
      if (next.length === prev.length) return prev
      pruned = true
      for (const item of prev) if (!next.includes(item)) props.onEvict?.(item.cacheKey)
      return next
    })
    if (pruned) scheduleColdDemotion()
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
        if (scoped.length === prev.length) return prev
        for (const item of prev) if (!scoped.includes(item)) props.onEvict?.(item.cacheKey)
        return scoped
      }
      const next = [...scoped, { key, cacheKey, project, ctx, used: ++used }]
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
    if (untrack(coldKeys).has(cacheKey)) {
      const next = new Set(untrack(coldKeys))
      next.delete(cacheKey)
      setColdKeys(next)
    }
    scheduleColdDemotion()
  })

  return (
    <For each={entries()}>
      {(entry) => {
        const active = createMemo(
          () => props.active() && `${props.project() ?? "single"}\0${props.current()}` === entry.cacheKey,
        )
        const cold = createMemo(() => !active() && coldKeys().has(entry.cacheKey))
        const entryProject = entry.project === "single" ? undefined : entry.project
        let slotEl: HTMLDivElement | undefined
        blurOnHide(active, () => slotEl)

        // Freeze reactive inputs while hidden so switching worktrees or background
        // diff polls never trigger Solid reactive churn inside inactive diff panels.
        const diffs = freezeValue(active, () => props.data()[diffDataKey(entryProject, entry.key)] ?? [])
        const loading = freezeValue(active, () => props.loading(entry.key))
        const loadingFiles = freezeValue(active, () => props.loadingFiles(entry.key))
        const notice = freezeValue(active, () => props.notice(entry.key))
        const canRevert = freezeValue(active, () => props.canRevert)
        const diffStyle = freezeValue(active, () => props.diffStyle)
        const markdownRender = freezeValue(active, () => props.markdownRender)
        const comments = freezeValue(active, () => props.comments(entry.key))
        const remoteComments = freezeValue(active, () => props.remoteComments?.(entry.ctx))
        const prTarget = freezeValue(active, () => props.prTarget?.(entry.ctx))
        const prSnapshot = freezeValue(active, () => props.prSnapshot?.(entry.ctx))
        const prLoading = freezeValue(active, () => props.prLoading?.(entry.ctx))
        const prError = freezeValue(active, () => props.prError?.(entry.ctx))
        const revertingFiles = freezeValue(active, () => props.revertingFiles(entry.key))
        const activeTerminalId = freezeValue(active, () => props.activeTerminalId)

        return (
          <div
            ref={slotEl}
            class="am-diff-panel-cache"
            classList={{
              "am-diff-panel-cache-active": active(),
              "am-diff-panel-cache-cold": cold(),
            }}
            aria-hidden={cold() || undefined}
            onFocusIn={(event) => {
              if (!active() && slotEl) skipInactiveFocus(event, slotEl)
            }}
          >
            <ViewActiveProvider active={active}>
              <DiffPanel
                diffs={diffs()}
                loading={loading()}
                active={active()}
                loadingFiles={loadingFiles()}
                sessionKey={entry.cacheKey}
                projectId={entryProject}
                worktreeId={entry.ctx}
                notice={notice()}
                lead={props.lead(active)}
                canRevert={canRevert()}
                diffStyle={diffStyle()}
                onDiffStyleChange={props.onDiffStyleChange}
                markdownRender={markdownRender()}
                onMarkdownRenderChange={props.onMarkdownRenderChange}
                comments={comments()}
                remoteComments={remoteComments()}
                remoteTarget={(comment) =>
                  entry.cacheKey === `${props.project() ?? "single"}\0${entry.key}`
                    ? props.remoteTarget?.(entry.ctx, comment)
                    : undefined
                }
                prTarget={prTarget()}
                prSnapshot={prSnapshot()}
                prLoading={prLoading()}
                prError={prError()}
                focusedComment={active() ? props.focusedComment?.(entry.key) : undefined}
                onCommentsChange={(next) => props.setComments(entry.key, next)}
                composer={props.composer(entry.cacheKey)}
                onSendClick={props.onSendClick}
                onClose={props.onClose}
                onExpand={props.onExpand}
                onRequestDiff={(file) => props.onRequestDiff(entry.key, file)}
                onOpenFile={(file, line) => props.onOpenFile(entry.ctx, file, line)}
                onOpenDocument={props.onOpenDocument}
                onRevertFile={(file) => props.onRevertFile(entry.key, entry.ctx, file)}
                revertingFiles={revertingFiles()}
                activeTerminalId={activeTerminalId()}
              />
            </ViewActiveProvider>
          </div>
        )
      }}
    </For>
  )
}
