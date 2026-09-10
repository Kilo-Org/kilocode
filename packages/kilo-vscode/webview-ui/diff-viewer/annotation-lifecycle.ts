import type { AnnotationMeta } from "./review-annotations"

// Pierre can replace an annotation without invoking its button handlers.
export function createAnnotationLifecycle() {
  const mounts = new Map<AnnotationMeta, { host: HTMLElement; dispose: () => void; connected: boolean }>()
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
    mounts.set(meta, { host, dispose, connected: host.isConnected })
    if (observer) return
    observer = new MutationObserver(() => {
      for (const [meta, entry] of mounts) {
        if (entry.host.isConnected) entry.connected = true
        else if (entry.connected) release(meta)
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
  }
  const clear = () => {
    for (const meta of mounts.keys()) release(meta)
  }
  return { track, clear }
}
