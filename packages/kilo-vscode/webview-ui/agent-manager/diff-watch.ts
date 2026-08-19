import { createEffect, type Accessor } from "solid-js"
import type { useVSCode } from "../src/context/vscode"
import type { WorktreeFileDiff } from "../src/types/messages"
import { wireDiffId } from "./worktree-diffs"

type Item = { id: string; type?: string }

interface Options {
  panel: Accessor<boolean>
  active: Accessor<boolean>
  id: Accessor<string | undefined>
  project: Accessor<string | undefined>
  data: Accessor<Record<string, WorktreeFileDiff[]>>
  dataKey: (id: string, projectId?: string) => string
  setLoading: (value: boolean) => void
  vscode: ReturnType<typeof useVSCode>
  order: Accessor<Item[]>
  selection: Accessor<string | null>
  local: string
}

export function createDiffWatch(opts: Options): void {
  createEffect(() => {
    const projectId = opts.project()
    const id = opts.id()
    if (opts.panel() || opts.active()) {
      if (!id) return
      const wired = wireDiffId(id, projectId)
      opts.setLoading(!opts.data()[opts.dataKey(id, projectId)])
      opts.vscode.postMessage({ type: "agentManager.startDiffWatch", ...wired })
      return
    }

    opts.setLoading(false)
    opts.vscode.postMessage({ type: "agentManager.stopDiffWatch" })
  })

  createEffect(() => {
    const order = opts.order()
    const selected = opts.selection() ?? opts.local
    const idx = order.findIndex((item) => item.id === selected)
    if (idx === -1) return
    const ids = order.filter((item) => item.type === "local" || item.type === "wt").map((item) => item.id)
    const adjacent = [order[idx - 1]?.id, order[idx + 1]?.id].filter((id): id is string =>
      Boolean(id && ids.includes(id)),
    )
    if (adjacent.length === 0) return
    opts.vscode.postMessage({
      type: "agentManager.preloadWorktreeDiffs",
      projectId: opts.project(),
      worktreeIds: adjacent,
    })
  })
}
