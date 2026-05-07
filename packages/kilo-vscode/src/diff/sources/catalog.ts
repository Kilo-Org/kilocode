import type { KiloConnectionService } from "../../services/cli-backend"
import type { PanelContext } from "../types"
import type { DiffSource, DiffSourceDescriptor } from "./types"
import { createWorktreeDiffSource, WORKSPACE_DESCRIPTOR, WORKSPACE_SOURCE_ID } from "./worktree"
import {
  SESSION_PREFIX,
  createSessionDiffSource,
  sessionDescriptor,
  sessionSourceId,
  type SessionDiffFetch,
  type SnapshotEnabledCheck,
} from "./session"
import { TURN_PREFIX, createTurnDiffSource, type TurnDiffFetch } from "./turn"

/**
 * Enumerates and constructs diff sources for a PanelContext.
 */
export class DiffSourceCatalog {
  private readonly sessionFetch: SessionDiffFetch = async ({ sessionID, directory }) => {
    const client = this.connection.getClient()
    const { data } = await client.session.diff({ sessionID, directory }, { throwOnError: true })
    return data ?? []
  }

  /**
   * Turn diffs are stored on the user message itself (`summary.diffs`), not
   * on the session-level snapshot. The `/session/:id/diff` endpoint ignores
   * its `messageID` param today, so we fetch the message directly instead.
   */
  private readonly turnFetch: TurnDiffFetch = async ({ sessionID, messageID, directory }) => {
    const client = this.connection.getClient()
    const { data } = await client.session.message({ sessionID, messageID, directory }, { throwOnError: true })
    const info = data?.info
    if (!info || info.role !== "user") return []
    return info.summary?.diffs ?? []
  }

  private readonly checkSnapshotsEnabled: SnapshotEnabledCheck = async (directory) => {
    const client = this.connection.getClient()
    const { data } = await client.config.get({ directory }, { throwOnError: true })
    // Snapshot tracking defaults to true when omitted.
    return data?.snapshot !== false
  }

  constructor(private readonly connection: KiloConnectionService) {}

  listAvailable(ctx: PanelContext): DiffSourceDescriptor[] {
    if (ctx.hidePicker) return []
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
    if (id === WORKSPACE_SOURCE_ID) return createWorktreeDiffSource(this.connection)

    if (id.startsWith(TURN_PREFIX)) {
      const [sessionId, messageId] = id.slice(TURN_PREFIX.length).split(":")
      if (!sessionId || !messageId) {
        throw new Error(`DiffSourceCatalog.build: malformed turn id "${id}" (expected turn:<sessionId>:<messageId>)`)
      }
      return createTurnDiffSource(sessionId, messageId, this.turnFetch, ctx.workspaceRoot)
    }

    if (id.startsWith(SESSION_PREFIX)) {
      const sessionId = id.slice(SESSION_PREFIX.length)
      if (!sessionId) throw new Error(`DiffSourceCatalog.build: empty session id in "${id}"`)
      return createSessionDiffSource(sessionId, this.sessionFetch, ctx.workspaceRoot, this.checkSnapshotsEnabled)
    }

    throw new Error(`DiffSourceCatalog.build: unknown source id "${id}"`)
  }
}
