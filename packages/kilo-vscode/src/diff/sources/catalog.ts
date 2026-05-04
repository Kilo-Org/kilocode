import type { KiloConnectionService } from "../../services/cli-backend"
import type { PanelContext } from "../types"
import type { DiffSource, DiffSourceDescriptor } from "./types"
import { WorktreeDiffSource, WORKSPACE_DESCRIPTOR } from "./worktree"
import { SESSION_PREFIX, SessionDiffSource, sessionDescriptor, type SessionDiffFetch } from "./session"

/**
 * Enumerates and constructs diff sources for a PanelContext.
 */
export class DiffSourceCatalog {
  private readonly sessionFetch: SessionDiffFetch = async ({ sessionID, directory }) => {
    const client = this.connection.getClient()
    const { data } = await client.session.diff({ sessionID, directory }, { throwOnError: true })
    return data ?? []
  }

  constructor(private readonly connection: KiloConnectionService) {}

  listAvailable(ctx: PanelContext): DiffSourceDescriptor[] {
    const out: DiffSourceDescriptor[] = []
    if (ctx.workspaceRoot) out.push(WORKSPACE_DESCRIPTOR)
    if (ctx.sessionId) out.push(sessionDescriptor(ctx.sessionId))
    return out
  }

  build(id: string, ctx: PanelContext): DiffSource {
    if (id === "workspace") return new WorktreeDiffSource(this.connection)

    if (id.startsWith(SESSION_PREFIX)) {
      const sessionId = id.slice(SESSION_PREFIX.length)
      if (!sessionId) throw new Error(`DiffSourceCatalog.build: empty session id in "${id}"`)
      return new SessionDiffSource(sessionId, this.sessionFetch, ctx.workspaceRoot)
    }

    throw new Error(`DiffSourceCatalog.build: unknown source id "${id}"`)
  }
}
