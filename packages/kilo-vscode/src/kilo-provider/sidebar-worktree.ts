import { GitOps } from "../agent-manager/GitOps"
import { getWorkspaceRoot } from "../review-utils"
import { handleContinueInWorktree } from "./continue-worktree"

interface Msg {
  type: string
  baseBranch?: string
  branchName?: string
  sessionId?: string
}

interface Ctx {
  post: (msg: unknown) => void
  openAgentManager: () => Thenable<unknown>
  openAdvancedWorktree: () => Thenable<unknown>
  openChanges: () => Thenable<unknown>
  createWorktree?: (baseBranch?: string, branchName?: string) => Promise<void>
  continueInWorktree?: (
    sessionId: string,
    progress: (status: string, detail?: string, error?: string) => void,
  ) => Promise<void>
}

async function repo(post: Ctx["post"]) {
  const root = getWorkspaceRoot()
  if (!root) return
  const git = new GitOps({ log: () => {} })
  const branch = await git.currentBranch(root).catch(() => "")
  git.dispose()
  if (!branch || branch === "HEAD") return
  post({ type: "agentManager.repoInfo", branch })
}

export async function handleSidebarWorktreeMessage(message: Msg, ctx: Ctx) {
  if (message.type === "openAgentManager") {
    await ctx.openAgentManager()
    return true
  }

  if (message.type === "openAdvancedWorktree") {
    await ctx.openAdvancedWorktree()
    return true
  }

  if (message.type === "agentManager.requestRepoInfo") {
    await repo(ctx.post)
    return true
  }

  if (message.type === "agentManager.createWorktree") {
    await ctx.createWorktree?.(message.baseBranch, message.branchName)
    return true
  }

  if (message.type === "openChanges") {
    await ctx.openChanges()
    return true
  }

  if (message.type !== "continueInWorktree") return false
  handleContinueInWorktree({
    sessionId: message.sessionId,
    handler: ctx.continueInWorktree,
    post: ctx.post,
  })
  return true
}
