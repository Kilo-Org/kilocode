import { showToast } from "@kilocode/kilo-ui/toast"
import { useBridge } from "./v2/vscode"
import { useLanguage } from "../src/context/language"

/**
 * Ask the host to merge the worktree's base branch. Only a worktree has a base, so Local explains instead.
 * The host owns the model of the update session, so no selection travels from the composer.
 */
export function useBaseUpdate() {
  const vscode = useBridge()
  const { t } = useLanguage()
  return (worktreeId: string | null, projectId?: string) => {
    if (!worktreeId || worktreeId === "local") {
      showToast({ title: t("agentManager.updateBase.title"), description: t("agentManager.updateBase.selectWorktree") })
      return
    }
    vscode.postMessage({
      type: "agentManager.updateFromBase",
      worktreeId,
      projectId,
    })
  }
}