import type {
  AgentManagerApplyWorktreeDiffResultMessage,
  AgentManagerDiffBranchesMessage,
  AgentManagerRevertWorktreeFileResultMessage,
  AgentManagerWorktreeDiffFileMessage,
  AgentManagerWorktreeDiffLoadingMessage,
  AgentManagerWorktreeDiffMessage,
  AgentManagerWorktreeDiffNoticeMessage,
  ExtensionMessage,
} from "../../src/types/messages"
import { isCurrent } from "./message-ownership"

type Handlers = {
  diff: (msg: AgentManagerWorktreeDiffMessage) => void
  file: (msg: AgentManagerWorktreeDiffFileMessage) => void
  loading: (msg: AgentManagerWorktreeDiffLoadingMessage) => void
  notice: (msg: AgentManagerWorktreeDiffNoticeMessage) => void
  branches: (msg: AgentManagerDiffBranchesMessage) => void
  apply: (msg: AgentManagerApplyWorktreeDiffResultMessage) => void
  revert: (msg: AgentManagerRevertWorktreeFileResultMessage) => void
}

export function routeReview(
  msg: ExtensionMessage,
  current: () => string | undefined,
  handlers: Handlers,
): "handled" | "stale" | "unhandled" {
  const dispatch = <T extends { projectId?: string }>(value: T, handle: (msg: T) => void): "handled" | "stale" => {
    if (!isCurrent(value, current())) return "stale"
    handle(value)
    return "handled"
  }

  switch (msg.type) {
    case "agentManager.worktreeDiff":
      return dispatch(msg, handlers.diff)
    case "agentManager.worktreeDiffFile":
      return dispatch(msg, handlers.file)
    case "agentManager.worktreeDiffLoading":
      return dispatch(msg, handlers.loading)
    case "agentManager.worktreeDiffNotice":
      return dispatch(msg, handlers.notice)
    case "agentManager.diffBranches":
      return dispatch(msg, handlers.branches)
    case "agentManager.applyWorktreeDiffResult":
      return dispatch(msg, handlers.apply)
    case "agentManager.revertWorktreeFileResult":
      return dispatch(msg, handlers.revert)
    default:
      return "unhandled"
  }
}
