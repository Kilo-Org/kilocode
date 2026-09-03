import type { Accessor } from "solid-js"
import type { VirtualizerHandle } from "virtua/solid"
import type { WorktreeFileDiff } from "../src/types/messages"

export function createReviewScrollPreserver(
  rows: Accessor<WorktreeFileDiff[]>,
  virtualizer: Accessor<VirtualizerHandle | undefined>,
) {
  return (run: () => void) => {
    const handle = virtualizer()
    const index = handle?.findItemIndex(handle.scrollOffset)
    const file = index === undefined ? undefined : rows()[index]?.file
    const offset = index === undefined ? 0 : (handle?.scrollOffset ?? 0) - (handle?.getItemOffset(index) ?? 0)
    run()
    if (!file) return
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const next = rows().findIndex((diff) => diff.file === file)
        if (next < 0) return
        virtualizer()?.scrollToIndex(next, { offset })
      })
    })
  }
}
