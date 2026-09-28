import type { AnnotationMeta } from "./review-annotations"

// Pierre can replace an annotation without invoking its button handlers.
export function createAnnotationLifecycle() {
  const mounts = new Map<AnnotationMeta, { host: HTMLElement; dispose: () => void }>()
  let observer: MutationObserver | undefined
  const release = (meta: AnnotationMeta) => {
    const entry = mounts.get(meta)
    if (!entry) return
    mounts.delete(meta)
    entry.dispose()
    if (mounts.size) return
    observer?.disconnect()
    observer = undefined
  }
  const track = (meta: AnnotationMeta, host: HTMLElement, dispose: () => void) => {
    release(meta)
    mounts.set(meta, { host, dispose })
    if (observer) return
    observer = new MutationObserver(() => {
      // The wrapper is inserted synchronously after track returns, so any host
      // still detached on an observer flush will never be shown. Releasing it
      // keeps a dropped annotation from retaining its form for the session.
      for (const [meta, entry] of mounts) {
        if (!entry.host.isConnected) release(meta)
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
  }
  const clear = () => {
    for (const meta of mounts.keys()) release(meta)
  }
  return { track, clear }
}
