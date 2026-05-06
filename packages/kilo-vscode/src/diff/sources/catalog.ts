import type { KiloConnectionService } from "../../services/cli-backend"
import type { PanelContext } from "../types"
import type { DiffSource, DiffSourceDescriptor } from "./types"
import { WorktreeDiffSource, WORKSPACE_DESCRIPTOR, WORKSPACE_SOURCE_ID } from "./worktree"
import {
  SESSION_PREFIX,
  SessionDiffSource,
  sessionDescriptor,
  sessionSourceId,
  type SessionDiffFetch,
  type SnapshotEnabledCheck,
} from "./session"

/**
 * Enumerates and constructs diff sources for a PanelContext.
 */
export class DiffSourceCatalog {
  private readonly sessionFetch: SessionDiffFetch = async ({ sessionID, directory }) => {
    const client = this.connection.getClient()
    const { data } = await client.session.diff({ sessionID, directory }, { throwOnError: true })
    return data ?? []
  }

  private readonly checkSnapshotsEnabled: SnapshotEnabledCheck = async (directory) => {
    const client = this.connection.getClient()
    const { data } = await client.config.get({ directory }, { throwOnError: true })
    // Snapshot tracking defaults to true when omitted.
    return data?.snapshot !== false
  }

  constructor(private readonly connection: KiloConnectionService) {}

  listAvailable(ctx: PanelContext): DiffSourceDescriptor[] {
    const out: DiffSourceDescriptor[] = []
    if (ctx.workspaceRoot) out.push(WORKSPACE_DESCRIPTOR)
    if (ctx.sessionId) out.push(sessionDescriptor(ctx.sessionId))
    return out
  }

  defaultSourceId(ctx: PanelContext): string | undefined {
    if (ctx.initialSourceId) return ctx.initialSourceId
    if (ctx.workspaceRoot) return WORKSPACE_SOURCE_ID
    if (ctx.sessionId) return sessionSourceId(ctx.sessionId)
    return undefined
  }

  build(id: string, ctx: PanelContext): DiffSource {
    if (id === WORKSPACE_SOURCE_ID) return new WorktreeDiffSource(this.connection)

    if (id.startsWith(SESSION_PREFIX)) {
      const sessionId = id.slice(SESSION_PREFIX.length)
      if (!sessionId) throw new Error(`DiffSourceCatalog.build: empty session id in "${id}"`)
      return new SessionDiffSource(sessionId, this.sessionFetch, ctx.workspaceRoot, this.checkSnapshotsEnabled)
    }

    throw new Error(`DiffSourceCatalog.build: unknown source id "${id}"`)
  }
}
