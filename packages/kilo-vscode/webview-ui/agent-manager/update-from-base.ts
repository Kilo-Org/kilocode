import { showToast } from "@kilocode/kilo-ui/toast"
import { useVSCode } from "../src/context/vscode"
import { useLanguage } from "../src/context/language"
import type { useSession } from "../src/context/session"

export function useBaseUpdate(session?: Pick<ReturnType<typeof useSession>, "currentSessionID" | "submission">) {
  const vscode = useVSCode()
  const { t } = useLanguage()
  return (worktreeId: string | null, projectId?: string, sessionId?: string) => {
    if (!worktreeId || worktreeId === "local") {
      showToast({ title: t("agentManager.updateBase.title"), description: t("agentManager.updateBase.selectWorktree") })
      return
    }
    // Only the active composer opts in. Worktree menus must not borrow its selection.
    const selection = sessionId && sessionId === session?.currentSessionID() ? session : undefined
    vscode.postMessage({
      type: "agentManager.updateFromBase",
      worktreeId,
      projectId,
      sessionId,
      ...selection?.submission(sessionId),
    })
  }
}
