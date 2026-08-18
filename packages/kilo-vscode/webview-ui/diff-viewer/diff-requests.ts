import { createEffect, on, type Accessor } from "solid-js"
import type { WorktreeFileDiff } from "../src/types/messages"
import { isDiffExpandable } from "./diff-open-policy"
import { diffToken } from "./diff-state"

interface DiffRequestOptions {
  key: Accessor<string | undefined>
  diffs: Accessor<WorktreeFileDiff[]>
  open: Accessor<string[]>
  loading: Accessor<Set<string> | undefined>
  send: Accessor<((file: string) => void) | undefined>
}

export function createDiffRequests(opts: DiffRequestOptions) {
  const requested = new Map<string, string>()

  createEffect(
    on(
      opts.key,
      () => {
        requested.clear()
      },
      { defer: true },
    ),
  )

  const request = (diff: WorktreeFileDiff) => {
    const send = opts.send()
    if (!send || opts.loading()?.has(diff.file)) return
    if (!isDiffExpandable(diff) || diff.summarized !== true) return
    const value = diffToken(diff)
    if (requested.get(diff.file) === value) return
    requested.set(diff.file, value)
    send(diff.file)
  }

  createEffect(
    on(
      () => [opts.open(), opts.diffs(), opts.loading()] as const,
      ([open, diffs]) => {
        const files = new Set(open)
        for (const file of requested.keys()) {
          if (!files.has(file)) requested.delete(file)
        }
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
