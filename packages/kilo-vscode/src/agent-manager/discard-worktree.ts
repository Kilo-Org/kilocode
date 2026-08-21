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
  let releasePtyCleanup: () => void
  try {
    releasePtyCleanup = await host.acquirePtyCleanup(dir)
  } catch (error) {
    host.log(`Failed to remove PTYs after worktree setup failed:`, error)
    return
  }

  try {
    if (sessionId) {
      try {
        await host.client().session.delete({ sessionID: sessionId, directory: dir }, { throwOnError: true })
      } catch (error) {
        host.log(`Failed to delete session ${sessionId} after worktree setup failed:`, error)
      }
    }
    await ctx.worktreeManager().removeWorktree(dir, branch)
    ctx.peekState()?.removeWorktree(id)
    host.push()
  } catch (error) {
    host.log(`Failed to remove worktree ${id} after setup failed:`, error)
    return
  } finally {
    releasePtyCleanup()
  }
}
