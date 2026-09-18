import { createRoot, getOwner, onCleanup } from "solid-js"

/** Keep mounted rows alive across the direct/virtual owners in the same update. */
export function createRowHandoff() {
  const owner = getOwner()
  const entries = new Map<string, { node: HTMLElement; dispose: () => void; slot?: HTMLElement }>()
  onCleanup(() => {
    for (const entry of entries.values()) entry.dispose()
    entries.clear()
  })

  return (key: string, render: () => HTMLElement) => {
    const entry =
      entries.get(key) ??
      createRoot((dispose) => {
        const entry = { node: render(), dispose, slot: undefined as HTMLElement | undefined }
        entries.set(key, entry)
        return entry
      }, owner)

    // Each insertion owner removes only its own slot, never a row that has
    // already moved to the other owner. The slot adds no layout box.
    const slot = document.createElement("div")
    slot.dataset.slot = "transcript-row-slot"
    slot.style.display = "contents"
    entry.slot = slot
    slot.append(entry.node)

    onCleanup(() => {
      if (entry.slot !== slot) return
      entry.slot = undefined
      queueMicrotask(() => {
        if (entry.slot || entries.get(key) !== entry) return
        entries.delete(key)
        entry.dispose()
      })
    })
    return slot
  }
}
