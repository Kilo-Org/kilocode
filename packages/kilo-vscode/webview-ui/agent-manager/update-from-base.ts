import { showToast } from "@kilocode/kilo-ui/toast"
import { useBridge } from "./v2/vscode"
import { useLanguage } from "../src/context/language"
import type { BaseUpdateTarget } from "./base-update-target"

/**
 * Ask the host to merge the worktree's base branch. Only a worktree has a base, so Local explains instead.
 */
export function useBaseUpdate() {
  const vscode = useBridge()
  const { t } = useLanguage()
  return (worktreeId: string | null, projectId?: string, target?: BaseUpdateTarget) => {
    if (!worktreeId || worktreeId === "local") {
      showToast({ title: t("agentManager.updateBase.title"), description: t("agentManager.updateBase.selectWorktree") })
      return
    }
    vscode.postMessage({
      type: "agentManager.updateFromBase",
      worktreeId,
      projectId,
      ...target,
    })
  }
}
