import type { ProjectContext } from "./project/context"
import type { LifecycleHost } from "./provider-lifecycle"

export async function discardWorktree(
  ctx: ProjectContext,
  host: LifecycleHost,
  id: string,
  dir: string,
  branch: string,
  sessionId?: string,
): Promise<void> {
  try {
    await host.removePtys(dir)
  } catch (error) {
    host.log(`Failed to remove PTYs after worktree setup failed:`, error)
    return
  }

  if (sessionId) {
    try {
      await host.client().session.delete({ sessionID: sessionId, directory: dir }, { throwOnError: true })
    } catch (error) {
      host.log(`Failed to delete session ${sessionId} after worktree setup failed:`, error)
      return
    }
  }

  try {
    await ctx.worktreeManager().removeWorktree(dir, branch)
  } catch (error) {
    host.log(`Failed to remove worktree ${id} after setup failed:`, error)
    return
  }
  ctx.peekState()?.removeWorktree(id)
  host.push()
}
