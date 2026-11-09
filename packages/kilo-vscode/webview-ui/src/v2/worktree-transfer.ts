// The Move to Worktree state shared by the sidebar and the Agent Manager panel. Both surfaces post the sidebar's
// unprefixed worktree messages; the host routes them to the Agent Manager and answers with the workspace branch and
// the transfer progress.
import { createSignal, onCleanup } from "solid-js"
import { showToast } from "@kilocode/kilo-ui/toast"
import { useLanguage } from "../context/language"
import { useVSCode } from "../context/vscode"

type HostMessage = { type: string; branch?: string; projectId?: string; status?: string; detail?: string; error?: string }

/** `project` names the workspace whose branch the row acts on, so a late answer from another project is ignored. */
export function createWorktreeTransfer(opts?: { project?: () => string | undefined }) {
  const vscode = useVSCode()
  const language = useLanguage()
  // The workspace project's current branch, so the row can create a worktree from it.
  const [branch, setBranch] = createSignal<string>()
  const [transferring, setTransferring] = createSignal(false)
  const [detail, setDetail] = createSignal("")
  const request = () => vscode.postMessage({ type: "agentManager.requestRepoInfo" } as never)
  onCleanup(
    vscode.onMessage((raw) => {
      const message = raw as unknown as HostMessage
      if (message.type === "agentManager.repoInfo") {
        const active = opts?.project?.()
        if (active && message.projectId && message.projectId !== active) return
        return setBranch(message.branch)
      }
      if (message.type !== "continueInWorktreeProgress") return
      if (message.status === "done") {
        setTransferring(false)
        setDetail("")
        request()
        return
      }
      if (message.status === "error") {
        setTransferring(false)
        setDetail("")
        request()
        showToast({ variant: "error", title: message.error ?? language.t("sidebar.session.progress.failed") })
        return
      }
      setDetail(language.t(`sidebar.session.progress.${message.status}`))
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
  return { branch, transferring, detail, request, move }
}
