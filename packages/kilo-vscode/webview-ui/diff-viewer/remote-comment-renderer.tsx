import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  type Component,
  type JSXElement,
  type Owner,
} from "solid-js"
import { render as mount } from "solid-js/web"
import { getOwner, runWithOwner } from "solid-js"
import type { AnnotationSide, DiffLineAnnotation } from "@pierre/diffs"
import { PRCommentCard } from "../agent-manager/pr/PRCommentCard"
import { githubUrl, prPayload } from "../agent-manager/pr/pr-comment-payload"
import type { PRComment } from "../agent-manager/pr/pr-types"
import { useLanguage } from "../src/context/language"
import { sendReviewComments } from "./review-annotations"
import type { AnnotationMeta } from "./review-annotations"
import type { WorktreeFileDiff } from "../src/types/messages"
import { mapRemoteComments, remoteLocation, type RemoteCommentAnchor, type RemoteCommentMap } from "./remote-comments"

export interface RemoteAnnotationMeta {
  type: "remote"
  file: string
  side: AnnotationSide
  line: number
  comments: PRComment[]
}

export type DiffAnnotationMeta = AnnotationMeta | RemoteAnnotationMeta

type Entry = {
  comment: () => PRComment
  setComment: (comment: PRComment) => void
  open: () => boolean
  setOpen: (open: boolean | ((prev: boolean) => boolean)) => void
  sent: () => boolean
  setSent: (sent: boolean) => void
}

type Mounted = {
  key: string
  host: HTMLElement
  setIds: (ids: string[]) => void
  dispose: () => void
  observer?: MutationObserver
  frame?: number
}

export interface RemoteCommentController {
  map: () => RemoteCommentMap
  annotations: (file: string) => DiffLineAnnotation<RemoteAnnotationMeta>[]
  outside: () => string[]
  fileCount: (file: string) => number
  location: (file: string, id: string) => "inline" | "outside" | "pending"
  open: (id: string) => void
  render: (meta: RemoteAnnotationMeta) => HTMLElement | undefined
  card: (id: string, inline: boolean) => JSXElement | undefined
  cleanup: () => void
}

interface Options {
  key: () => string | undefined
  comments: () => PRComment[] | undefined
  loading?: () => ReadonlySet<string> | undefined
  diffs: () => WorktreeFileDiff[]
  active: () => boolean
  activeTerminalId: () => string | undefined
  onSendClick?: () => void
  onOpenFile?: (file: string, line?: number) => void
  onOpenUrl?: (url: string) => void
}

interface CardProps {
  item: Entry
  inline: boolean
}

function remoteIds(anchor: RemoteCommentAnchor): string[] {
  return anchor.comments.map((comment) => comment.threadId)
}

function findTarget(container: HTMLElement, id: string, place: "inline" | "outside"): HTMLElement | undefined {
  const selector =
    place === "inline"
      ? ".am-remote-comment-annotations [data-thread-id]"
      : ".am-remote-comments-outside [data-thread-id]"
  for (const node of container.querySelectorAll<HTMLElement>(selector)) {
    if (node.dataset.threadId === id) return node
  }
  return undefined
}

export function createRemoteCommentController(options: Options): RemoteCommentController {
  const owner: Owner | null = getOwner()
  const entries = new Map<string, Entry>()
  const mounted = new Map<string, Mounted>()
  const annotations = new Map<string, { ids: string; value: DiffLineAnnotation<RemoteAnnotationMeta> }>()
  const mapped = createMemo(() => {
    if (!options.active()) return { anchors: new Map<string, RemoteCommentAnchor[]>(), outside: [] as PRComment[] }
    return mapRemoteComments(options.comments() ?? [], options.diffs())
  })
  let disposed = false

  const releaseMounted = (item: Mounted) => {
    if (item.frame !== undefined) cancelAnimationFrame(item.frame)
    item.observer?.disconnect()
    item.dispose()
    if (mounted.get(item.key) === item) mounted.delete(item.key)
  }

  const disposeMounted = () => {
    for (const item of mounted.values()) releaseMounted(item)
  }

  const entry = (comment: PRComment): Entry => {
    const current = entries.get(comment.threadId)
    if (current) {
      current.setComment(comment)
      return current
    }
    const [value, setValue] = createSignal(comment)
    const [open, setOpen] = createSignal(!comment.resolved && !comment.outdated)
    const [sent, setSent] = createSignal(false)
    const next = { comment: value, setComment: setValue, open, setOpen, sent, setSent }
    entries.set(comment.threadId, next)
    return next
  }

  const sync = () => {
    if (!options.active()) return
    const current = new Set<string>()
    for (const comment of options.comments() ?? []) {
      current.add(comment.threadId)
      entry(comment)
    }
    for (const id of entries.keys()) {
      if (!current.has(id)) entries.delete(id)
    }
  }

  createEffect(
    on(
      () => [options.key(), options.active()] as const,
      () => {
        disposeMounted()
        entries.clear()
        annotations.clear()
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => [options.key(), options.active(), options.comments(), options.diffs()] as const,
      () => sync(),
      { defer: true },
    ),
  )

  const card = (id: string, inline: boolean) => {
    const comment = (options.comments() ?? []).find((value) => value.threadId === id)
    if (comment) entry(comment)
    const item = entries.get(id)
    if (!item) return undefined
    return <RemoteCard item={item} inline={inline} />
  }

  const RemoteCard: Component<CardProps> = (props) => {
    const comment = () => props.item.comment()
    return (
      <PRCommentCard
        comment={comment()}
        resolved={comment().resolved}
        pending={false}
        sent={props.item.sent()}
        open={props.item.open()}
        inline={props.inline}
        onToggleOpen={() => props.item.setOpen((value) => !value)}
        onSend={() => {
          const value = comment()
          sendReviewComments([prPayload(value)], options.activeTerminalId())
          props.item.setSent(true)
          options.onSendClick?.()
        }}
        onOpenFile={
          comment().file && options.onOpenFile
            ? () =>
                options.onOpenFile?.(
                  comment().file!,
                  comment().outdated || comment().side === "deletions" ? undefined : comment().line,
                )
            : undefined
        }
        onOpenUrl={
          githubUrl(comment().url) && options.onOpenUrl
            ? () => options.onOpenUrl?.(githubUrl(comment().url)!)
            : undefined
        }
      />
    )
  }

  const render = (meta: RemoteAnnotationMeta) => {
    if (disposed) return
    const key = `${meta.file}:${meta.side}:${meta.line}`
    const ids = meta.comments.map((comment) => comment.threadId)
    const current = mounted.get(key)
    if (current) {
      current.setIds(ids)
      return current.host
    }
    const host = document.createElement("div")
    host.className = "am-remote-comment-annotations"
    host.dataset.remoteAnnotation = key
    const [values, setIds] = createSignal(ids)
    const attach = () => mount(() => <For each={values()}>{(id) => card(id, true)}</For>, host)
    const dispose = owner ? runWithOwner(owner, attach) : attach()
    if (!dispose) return
    const item: Mounted = { key, host, setIds, dispose }
    mounted.set(key, item)
    item.frame = requestAnimationFrame(() => {
      item.frame = undefined
      if (!host.isConnected) return releaseMounted(item)
      const parent = host.parentNode
      const scope = host.closest(".am-diff-panel, .am-review-layout") ?? parent?.parentNode ?? parent
      if (!(scope instanceof Node)) return
      item.observer = new MutationObserver(() => {
        if (!host.isConnected) releaseMounted(item)
      })
      item.observer.observe(scope, { childList: true, subtree: true })
    })
    return host
  }

  const fileAnnotations = (file: string): DiffLineAnnotation<RemoteAnnotationMeta>[] =>
    (mapped().anchors.get(file) ?? []).map((anchor: RemoteCommentAnchor) => {
      const ids = remoteIds(anchor).join("\0")
      const key = `${anchor.file}:${anchor.side}:${anchor.line}`
      const current = annotations.get(key)
      if (current?.ids === ids) return current.value
      const value: DiffLineAnnotation<RemoteAnnotationMeta> = {
        side: anchor.side,
        lineNumber: anchor.line,
        metadata: {
          type: "remote",
          file: anchor.file,
          side: anchor.side,
          line: anchor.line,
          comments: anchor.comments,
        },
      }
      annotations.set(key, { ids, value })
      return value
    })

  const outside = createMemo(() => mapped().outside.map((comment) => comment.threadId))

  onCleanup(() => {
    disposed = true
    disposeMounted()
    entries.clear()
  })

  return {
    map: mapped,
    annotations: fileAnnotations,
    outside,
    fileCount: (file) => {
      const anchors = mapped().anchors.get(file) ?? []
      return anchors.reduce((count: number, anchor: RemoteCommentAnchor) => count + anchor.comments.length, 0)
    },
    location: (file, id) => {
      const comment = (options.comments() ?? []).find((item) => item.threadId === id)
      const diff = options.diffs().find((item) => item.file === file)
      if (
        diff?.summarized === true &&
        comment?.line !== undefined &&
        !comment.outdated &&
        options.loading?.()?.has(file)
      )
        return "pending"
      return remoteLocation(mapped(), file, id)
    },
    open: (id) => {
      const comment = (options.comments() ?? []).find((item) => item.threadId === id)
      if (comment) entry(comment).setOpen(true)
    },
    render,
    card,
    cleanup: () => disposeMounted(),
  }
}

export function createRemoteFocus(
  root: () => HTMLElement | undefined,
  pending?: (file?: string) => void,
  scroll?: { root: () => HTMLElement | undefined; to: (offset: number) => void },
) {
  let observer: MutationObserver | undefined
  let frame: number | undefined
  let token = 0

  const stop = () => {
    token += 1
    observer?.disconnect()
    observer = undefined
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = undefined
    pending?.()
  }

  const move = (card: HTMLElement, inline: boolean) => {
    const view = inline ? scroll?.root() : undefined
    if (!view) return card.scrollIntoView({ block: "center", behavior: "smooth" })
    const rect = card.getBoundingClientRect()
    scroll?.to(view.scrollTop + rect.top - view.getBoundingClientRect().top - view.clientHeight / 2 + rect.height / 2)
  }

  const request = (
    id: string,
    file: string,
    prepare: () => void,
    location: () => "inline" | "outside" | "pending",
    reveal?: () => boolean,
  ) => {
    stop()
    const current = token
    pending?.(file)
    prepare()

    const settle = () => {
      if (current !== token) return true
      const container = root()
      if (!container) return false
      const place = location()
      if (place === "pending") return false
      if (place === "inline" && reveal && !reveal()) return false
      const target = findTarget(container, id, place)
      if (!target) return false
      if (place === "inline") {
        const shadow = target.closest("diffs-container")?.shadowRoot
        if (shadow) observer?.observe(shadow, { childList: true, subtree: true })
        const slot = target.closest<HTMLElement>("[data-annotation-slot]")
        const rect = target.getBoundingClientRect()
        if ((slot && !slot.assignedSlot) || rect.width <= 0 || rect.height <= 0) return false
      }
      const card = target.closest<HTMLElement>('[data-component="pr-comment"], .am-pr-comment') ?? target
      move(card, place === "inline")
      const focus = card.querySelector<HTMLElement>('[data-slot="button"], button')
      focus?.focus({ preventScroll: true })
      stop()
      return true
    }

    if (settle()) return
    observer = new MutationObserver(settle)
    const container = root()
    if (container) observer.observe(container, { childList: true, subtree: true })
    frame = requestAnimationFrame(() => {
      frame = undefined
      settle()
    })
  }

  onCleanup(stop)
  return { request, stop }
}

interface OutsideProps {
  controller: RemoteCommentController
}

export const RemoteCommentsOutside: Component<OutsideProps> = (props) => {
  const { t } = useLanguage()
  return (
    <Show when={props.controller.outside().length > 0}>
      <section class="am-remote-comments-outside" data-remote-outside="true">
        <div class="am-remote-comments-outside-title">{t("agentManager.pr.comment.unplaced")}</div>
        <div class="am-remote-comments-outside-hint">{t("agentManager.pr.comment.unplacedHint")}</div>
        <div class="am-remote-comments-outside-list">
          <For each={props.controller.outside()}>
            {(id) => (
              <div class="am-remote-comment-outside" data-remote-thread-id={id}>
                {props.controller.card(id, false)}
              </div>
            )}
          </For>
        </div>
      </section>
    </Show>
  )
}
