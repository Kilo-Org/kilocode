import { createEffect, createSignal, on, onCleanup, type Accessor } from "solid-js"
import type { WorktreeFileDiff } from "../src/types/messages"
import { isDiffExpandable } from "./diff-open-policy"
import { diffToken } from "./diff-state"

interface DiffRequestOptions {
  key: Accessor<string | undefined>
  diffs: Accessor<WorktreeFileDiff[]>
  open: Accessor<string[]>
  loading: Accessor<Set<string> | undefined>
  send: Accessor<((file: string) => void) | undefined>
  eager?: boolean
}

type Watch = { observer: IntersectionObserver; entries: Map<Element, (visible: boolean) => void> }

const watchers = new WeakMap<Element, Watch>()
const MARGIN = 200

function observeDiffRequest(node: Element, root: Element, run: (visible: boolean) => void): () => void {
  if (typeof IntersectionObserver === "undefined") {
    run(true)
    return () => {}
  }

  let state = watchers.get(root)
  if (!state) {
    const entries = new Map<Element, (visible: boolean) => void>()
    const observer = new IntersectionObserver(
      (items) => {
        for (const item of items) entries.get(item.target)?.(item.isIntersecting)
      },
      { root, rootMargin: `${MARGIN}px 0px` },
    )
    state = { observer, entries }
    watchers.set(root, state)
  }

  state.entries.set(node, run)
  state.observer.observe(node)
  return () => {
    state.entries.delete(node)
    state.observer.unobserve(node)
    if (state.entries.size > 0) return
    state.observer.disconnect()
    if (watchers.get(root) === state) watchers.delete(root)
  }
}

export function createDiffViewport(root: Accessor<Element | undefined>) {
  const [element, setElement] = createSignal<Element>()
  const [visible, setVisible] = createSignal(false)
  createEffect(() => {
    const node = element()
    const viewport = root()
    if (!node || !viewport) return
    onCleanup(observeDiffRequest(node, viewport, setVisible))
  })
  const intersects = () => {
    const node = element()
    const viewport = root()
    if (!node || !viewport) return false
    const bounds = node.getBoundingClientRect()
    const box = viewport.getBoundingClientRect()
    return (
      bounds.width > 0 && bounds.height > 0 && bounds.bottom >= box.top - MARGIN && bounds.top <= box.bottom + MARGIN
    )
  }
  return { ref: (node: Element) => setElement(node), visible, intersects }
}

export function createDiffRequests(opts: DiffRequestOptions) {
  const requested = new Map<string, string>()
  let active = false

  createEffect(
    on(
      opts.key,
      () => {
        requested.clear()
      },
      { defer: true },
    ),
  )

  const request = (diff: WorktreeFileDiff, visible?: () => boolean) => {
    const send = opts.send()
    if (!send || opts.loading()?.has(diff.file)) return
    if (!isDiffExpandable(diff) || diff.summarized !== true) return
    const value = diffToken(diff)
    if (requested.get(diff.file) === value || visible?.() === false) return
    requested.set(diff.file, value)
    send(diff.file)
  }

  createEffect(
    on(
      () => [opts.open(), opts.diffs(), opts.loading(), opts.send()] as const,
      ([open, diffs]) => {
        if (!opts.send()) {
          requested.clear()
          active = false
          return
        }
        if (!active) {
          requested.clear()
          active = true
        }
        const files = new Set(open)
        for (const file of requested.keys()) {
          if (!files.has(file)) requested.delete(file)
        }
        if (opts.eager === false) return
        for (const file of open) {
          const diff = diffs.find((item) => item.file === file)
          if (!diff || diff.kind === "image") continue
          request(diff)
        }
      },
    ),
  )

  return request
}
