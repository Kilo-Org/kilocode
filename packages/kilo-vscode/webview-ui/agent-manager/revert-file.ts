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
  vscode: VsCode,
  showToast: (t: Toast) => void,
  t: (key: string) => string,
  projectId?: Accessor<string | undefined>,
) {
  const [files, setFiles] = createSignal<Record<string, Set<string>>>({})
  const key = (project: string | undefined, scope: string) => `${project ?? "single"}\0${scope}`

  const reverting = createMemo(() => {
    const id = diffScopeId()
    if (!id) return new Set<string>()
    return files()[key(projectId?.(), id)] ?? new Set<string>()
  })

  const revertingFor = (id: string) => files()[key(projectId?.(), id)] ?? new Set<string>()

  function revertFor(id: string | undefined, context: string | undefined, source: string, file: string) {
    if (!id || !context) return
    const data = key(projectId?.(), id)
    setFiles((prev) => {
      const set = new Set(prev[data] ?? [])
      set.add(file)
      return { ...prev, [data]: set }
    })
    vscode.postMessage({
      type: "agentManager.revertWorktreeFile",
      projectId: projectId?.(),
      sessionId: context,
      file,
      scope: source,
    })
  }

  function revert(file: string) {
    revertFor(diffScopeId(), ctx(), scope(), file)
  }

  function onResult(ev: AgentManagerRevertWorktreeFileResultMessage) {
    const data = key(ev.projectId, ev.sessionId)
    setFiles((prev) => {
      const set = new Set(prev[data] ?? [])
      set.delete(ev.file)
      const next = { ...prev }
      if (set.size === 0) delete next[data]
      else next[data] = set
      return next
    })
    if (ev.status === "success") {
      showToast({ variant: "success", title: t("agentManager.diff.revertSuccess"), description: ev.file })
    } else {
      showToast({ variant: "error", title: t("agentManager.diff.revertError"), description: ev.message })
    }
  }

  return { reverting, revertingFor, revert, revertFor, onResult }
}
