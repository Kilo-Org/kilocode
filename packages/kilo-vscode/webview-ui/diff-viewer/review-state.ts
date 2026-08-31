import { createEffect, createMemo, createSignal, on, type Accessor } from "solid-js"
import type { WorktreeFileDiff } from "../src/types/messages"
import { initialOpenFiles, reconcileOpenFiles, sanitizeOpenFiles } from "./diff-open-policy"

export function createReviewOpenState(diffs: Accessor<WorktreeFileDiff[]>, key: Accessor<string | undefined>) {
  const [manual, setManual] = createSignal<Record<string, string[]>>({})
  const [known, setKnown] = createSignal<Record<string, string[]>>({})
  const open = createMemo(() => {
    const id = key() ?? ""
    const files = diffs()
    if (files.length === 0) return []
    const value = manual()[id]
    return value ? sanitizeOpenFiles(files, value) : initialOpenFiles(files)
  })

  createEffect(
    on(
      () => [key(), diffs()] as const,
      ([current, files]) => {
        if (files.length === 0) return
        const id = current ?? ""
        const value = manual()[id]
        const result = reconcileOpenFiles(files, value, known()[id] ?? [])
        setKnown((prev) => ({ ...prev, [id]: result.known }))
        if (!value || !result.open) return
        if (result.open.length === value.length && result.open.every((file, index) => file === value[index])) return
        setManual((prev) => ({ ...prev, [id]: result.open! }))
      },
    ),
  )

  const setOpen = (files: string[] | ((prev: string[]) => string[])) => {
    const id = key() ?? ""
    const current = open()
    const next = typeof files === "function" ? files(current) : files
    setManual((prev) => ({ ...prev, [id]: sanitizeOpenFiles(diffs(), next) }))
  }

  return { open, setOpen }
}
