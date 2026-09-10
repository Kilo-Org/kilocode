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
) {
  const [files, setFiles] = createSignal<Record<string, Set<string>>>({})

  const reverting = createMemo(() => {
    const id = diffScopeId()
    if (!id) return new Set<string>()
    return files()[id] ?? new Set<string>()
  })

  function revert(file: string) {
    const id = diffScopeId()
    const context = ctx()
    if (!id || !context) return
    setFiles((prev) => {
      const set = new Set(prev[id] ?? [])
      set.add(file)
      return { ...prev, [id]: set }
    })
    vscode.postMessage({ type: "agentManager.revertWorktreeFile", sessionId: context, file, scope: scope() })
  }

  function onResult(ev: AgentManagerRevertWorktreeFileResultMessage) {
    setFiles((prev) => {
      const set = new Set(prev[ev.sessionId] ?? [])
      set.delete(ev.file)
      const next = { ...prev }
      if (set.size === 0) delete next[ev.sessionId]
      else next[ev.sessionId] = set
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
