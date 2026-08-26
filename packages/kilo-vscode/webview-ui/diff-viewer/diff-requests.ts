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
  batch?: Accessor<((files: string[]) => void) | undefined>
}

const LIMIT = 16

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

  const eligible = (diff: WorktreeFileDiff) => {
    if (opts.loading()?.has(diff.file)) return false
    if (!isDiffExpandable(diff) || diff.summarized !== true) return false
    return requested.get(diff.file) !== diffToken(diff)
  }

  const request = (diff: WorktreeFileDiff) => {
    const send = opts.send()
    if (!send || !eligible(diff)) return
    requested.set(diff.file, diffToken(diff))
    send(diff.file)
  }

  createEffect(
    on(
      () => [opts.open(), opts.diffs(), opts.loading(), opts.send(), opts.batch?.()] as const,
      ([open, diffs, , , batch]) => {
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
        const next = open
          .map((file) => diffs.find((item) => item.file === file))
          .filter((diff): diff is WorktreeFileDiff => !!diff && diff.kind !== "image" && eligible(diff))
        if (!batch || next.length < 2) {
          for (const diff of next) request(diff)
          return
        }
        for (let index = 0; index < next.length; index += LIMIT) {
          const chunk = next.slice(index, index + LIMIT)
          for (const diff of chunk) requested.set(diff.file, diffToken(diff))
          batch(chunk.map((diff) => diff.file))
        }
      },
    ),
  )

  return request
}
