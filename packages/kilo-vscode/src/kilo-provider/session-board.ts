import type { KiloClient, Session } from "@kilocode/sdk/v2/client"
import type { ProjectRouteService } from "../agent-manager/project/route"
import { getErrorMessage, sameDirectory } from "../kilo-provider-utils"
import type {
  RequestSessionBoardMessage,
  ResetSessionBoardMessage,
  SessionBoardLoadedMessage,
} from "../../webview-ui/src/types/messages/board"

type Request = RequestSessionBoardMessage | ResetSessionBoardMessage

type Context = {
  client: KiloClient | null
  routes?: ProjectRouteService
  projectId?: string
  directories: ReadonlyMap<string, string>
  session: Pick<Session, "id" | "directory"> | null
  post: (message: SessionBoardLoadedMessage) => void
}

function valid(input: Record<string, unknown>): input is Record<string, unknown> & Request {
  if (typeof input.sessionID !== "string" || !input.sessionID) return false
  if (typeof input.requestID !== "string" || !input.requestID) return false
  if (input.projectId !== undefined && (typeof input.projectId !== "string" || !input.projectId)) return false
  if (input.type === "resetSessionBoard") {
    return typeof input.revision === "number" && Number.isSafeInteger(input.revision) && input.revision >= 0
  }
  return (
    (input.before === undefined || (typeof input.before === "string" && !!input.before)) &&
    (input.limit === undefined ||
      (typeof input.limit === "number" && Number.isInteger(input.limit) && input.limit >= 1 && input.limit <= 50))
  )
}

function scope(input: Request, ctx: Context) {
  const projectId = input.projectId ?? ctx.projectId
  const directory =
    ctx.directories.get(input.sessionID) ?? (ctx.session?.id === input.sessionID ? ctx.session.directory : undefined)
  if (ctx.routes) {
    if (projectId) {
      const routed = ctx.routes.trySessionDirectoryFor({ projectId, sessionId: input.sessionID })
      if (routed) return { projectId, directory: routed }
      const root = ctx.routes.projectRoot({ projectId })
      if (
        directory &&
        (sameDirectory(directory, root) ||
          (ctx.projectId === projectId &&
            ctx.session?.id === input.sessionID &&
            sameDirectory(directory, ctx.session.directory)))
      )
        return { projectId, directory }
      throw new Error("The session is not available in this project. Open the session again.")
    }
    if (ctx.routes.isSessionAmbiguous(input.sessionID)) {
      throw new Error("This session exists in multiple projects. Open its board from the owning project.")
    }
    const routed = ctx.routes.trySessionDirectory(input.sessionID)
    if (routed) return { directory: routed, projectId }
  }
  if (!directory) throw new Error("The session directory is unavailable. Open the session again.")
  return { directory, projectId }
}

export async function handle(input: Record<string, unknown>, ctx: Context): Promise<boolean> {
  if (input.type !== "requestSessionBoard" && input.type !== "resetSessionBoard") return false
  if (typeof input.sessionID !== "string" || typeof input.requestID !== "string") return true
  const result = { type: "sessionBoardLoaded", sessionID: input.sessionID, requestID: input.requestID } as const
  if (!valid(input)) {
    ctx.post({ ...result, error: "Invalid board request." })
    return true
  }
  const projectId = input.projectId ?? ctx.projectId
  try {
    const client = ctx.client
    if (!client) throw new Error("Not connected to the CLI backend.")
    const target = scope(input, ctx)
    const { data } =
      input.type === "requestSessionBoard"
        ? await client.kilocode.sessionBoard(
            {
              sessionID: input.sessionID,
              directory: target.directory,
              before: input.before,
              limit: input.limit,
            },
            { throwOnError: true },
          )
        : await client.kilocode.resetSessionBoard(
            { sessionID: input.sessionID, directory: target.directory, revision: input.revision },
            { throwOnError: true },
          )
    if (!data) throw new Error("The board is unavailable.")
    if (data.ownerSessionID !== input.sessionID) throw new Error("Open the board from its owning session.")
    ctx.post({ ...result, projectId: target.projectId, board: data })
  } catch (error) {
    ctx.post({ ...result, projectId, error: getErrorMessage(error) })
  }
  return true
}
