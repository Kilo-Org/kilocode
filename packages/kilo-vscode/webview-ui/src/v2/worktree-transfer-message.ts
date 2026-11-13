// The Host message reducer behind the shared Move to Worktree state. Kept free of DOM and UI imports so tests can
// cover the project scoping and the transfer transitions directly.
export type HostMessage = {
  type: string
  branch?: string
  projectId?: string
  status?: string
  detail?: string
  error?: string
}

export type WorktreeTransferState = { branch?: string; transferring: boolean; detail: string }

export type WorktreeTransferResult = { state: WorktreeTransferState; refresh?: boolean; toast?: string }

/** The idle state for a panel that switched projects: no branch and no transfer left from the previous project. */
export function clearWorktreeTransfer(): WorktreeTransferState {
  return { branch: undefined, transferring: false, detail: "" }
}

/**
 * Reduces one host message into worktree transfer state. Returns undefined for messages the transfer does not own,
 * including a branch answer for another project, so a stale answer cannot enable actions for the wrong workspace.
 */
export function reduceWorktreeTransfer(
  state: WorktreeTransferState,
  message: HostMessage,
  options: { activeProject?: string; progress: (status: string) => string; failed: string },
): WorktreeTransferResult | undefined {
  if (message.type === "agentManager.repoInfo") {
    if (options.activeProject && message.projectId && message.projectId !== options.activeProject) return undefined
    return { state: { ...state, branch: message.branch } }
  }
  if (message.type !== "continueInWorktreeProgress" || !message.status) return undefined
  if (message.status === "done") return { state: { ...state, transferring: false, detail: "" }, refresh: true }
  if (message.status === "error")
    return { state: { ...state, transferring: false, detail: "" }, refresh: true, toast: message.error ?? options.failed }
  return { state: { ...state, detail: options.progress(message.status) } }
}
