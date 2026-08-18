import { createSignal, createMemo, type Accessor } from "solid-js"
import type { AgentManagerRevertWorktreeFileResultMessage } from "../src/types/messages"

interface VsCode {
  postMessage(msg: unknown): void
}

interface Toast {
  variant: "success" | "error"
  title: string
  description: string
}

export function createRevertFile(
  diffScopeId: Accessor<string | undefined>,
  ctx: Accessor<string | undefined>,
  scope: Accessor<string>,
  project: Accessor<string | undefined>,
  vscode: VsCode,
  showToast: (t: Toast) => void,
  t: (key: string) => string,
) {
  const [files, setFiles] = createSignal<Record<string, Set<string>>>({})
  const key = (id: string, projectId = project()) => (projectId ? `${projectId}\0${id}` : id)

  const reverting = createMemo(() => {
    const id = diffScopeId()
    if (!id) return new Set<string>()
    return files()[key(id)] ?? new Set<string>()
  })

  function revert(file: string) {
    const id = diffScopeId()
    const context = ctx()
    if (!id || !context) return
    const projectId = project()
    const dataKey = key(id, projectId)
    setFiles((prev) => {
      const set = new Set(prev[dataKey] ?? [])
      set.add(file)
      return { ...prev, [dataKey]: set }
    })
    vscode.postMessage({
      type: "agentManager.revertWorktreeFile",
      projectId,
      sessionId: context,
      file,
      scope: scope(),
    })
  }

  function onResult(ev: AgentManagerRevertWorktreeFileResultMessage) {
    const dataKey = key(ev.sessionId, ev.projectId)
    setFiles((prev) => {
      const set = new Set(prev[dataKey] ?? [])
      set.delete(ev.file)
      const next = { ...prev }
      if (set.size === 0) delete next[dataKey]
      else next[dataKey] = set
      return next
    })
    if (ev.status === "success") {
      showToast({ variant: "success", title: t("agentManager.diff.revertSuccess"), description: ev.file })
    } else {
      showToast({ variant: "error", title: t("agentManager.diff.revertError"), description: ev.message })
    }
  }

  return { reverting, revert, onResult }
}
