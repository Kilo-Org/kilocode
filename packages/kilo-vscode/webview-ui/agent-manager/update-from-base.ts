import { showToast } from "@kilocode/kilo-ui/toast"
import { useVSCode } from "../src/context/vscode"
import { useLanguage } from "../src/context/language"

export function useBaseUpdate() {
  const vscode = useVSCode()
  const { t } = useLanguage()
  return (worktreeId: string | null, projectId?: string, sessionId?: string) => {
    if (!worktreeId || worktreeId === "local") {
      showToast({ title: t("agentManager.updateBase.title"), description: t("agentManager.updateBase.selectWorktree") })
      return
    }
    vscode.postMessage({ type: "agentManager.updateFromBase", worktreeId, projectId, sessionId })
  }
}
