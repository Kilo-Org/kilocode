// The Move to Worktree state shared by the sidebar and the Agent Manager panel. Both surfaces post the worktree
// message; the host routes it to the Agent Manager and answers with the workspace branch and the transfer progress.
import { createSignal, onCleanup } from "solid-js"
import { showToast } from "@kilocode/kilo-ui/toast"
import { useLanguage } from "../context/language"
import { useVSCode } from "../context/vscode"
import { reduceWorktreeTransfer, type HostMessage } from "./worktree-transfer-message"

/** `project` names the workspace whose branch the row acts on, so a late answer from another project is ignored. */
export function createWorktreeTransfer(opts?: { project?: () => string | undefined }) {
  const vscode = useVSCode()
  const language = useLanguage()
  // The workspace project's current branch, so the row can create a worktree from it.
  const [branch, setBranch] = createSignal<string>()
  const [transferring, setTransferring] = createSignal(false)
  const [detail, setDetail] = createSignal("")
  const request = () => vscode.postMessage({ type: "agentManager.requestRepoInfo" } as never)
  // The panel calls this when it switches projects, so a branch from the previous project cannot stay visible.
  const clear = () => setBranch(undefined)
  onCleanup(
    vscode.onMessage((raw) => {
      const next = reduceWorktreeTransfer(
        { branch: branch(), transferring: transferring(), detail: detail() },
        raw as unknown as HostMessage,
        {
          activeProject: opts?.project?.(),
          progress: (status) => language.t(`sidebar.session.progress.${status}`),
          failed: language.t("sidebar.session.progress.failed"),
        },
      )
      if (!next) return
      setBranch(next.state.branch)
      setTransferring(next.state.transferring)
      setDetail(next.state.detail)
      if (next.refresh) request()
      if (next.toast) showToast({ variant: "error", title: next.toast })
    }),
  )
  // The branch changes after a checkout, so ask again when the view returns and before the first transfer.
  const onVisible = () => {
    if (document.visibilityState === "visible") request()
  }
  document.addEventListener("visibilitychange", onVisible)
  onCleanup(() => document.removeEventListener("visibilitychange", onVisible))
  request()
  const move = (sessionID: string) => {
    if (transferring()) return
    setTransferring(true)
    setDetail(language.t("sidebar.session.progress.capturing"))
    vscode.postMessage({ type: "agentManager.continueInWorktree", sessionId: sessionID } as never)
  }
  return { branch, transferring, detail, request, clear, move }
}
