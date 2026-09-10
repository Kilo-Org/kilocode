import type { OpenCodeClient } from "@opencode-ai/client/promise"
import path from "node:path"
import { sessionView } from "./projection"
import { result, type AdapterOptions } from "./result"

/** Original past-chat picker and first-use work-style listing over native v2 pages. */
export function createSessionSearchMethods(client: OpenCodeClient, defaultDirectory: string) {
  return {
    list: <Throw extends boolean = false>(
      input: {
        directory?: string
        workspace?: string
        worktrees?: boolean
        roots?: boolean
        archived?: boolean
        search?: string
        limit?: number
      } = {},
      options?: AdapterOptions<Throw>,
    ) =>
      result(async () => {
        const limit = input.limit ?? 100
        if (!Number.isInteger(limit) || limit < 1) throw new Error("Session search limit must be a positive integer")
        const location = input.worktrees
          ? await client.location.get(
              { location: { directory: input.directory ?? defaultDirectory, workspace: input.workspace } },
              options,
            )
          : undefined
        const roots = location
          ? [
              location.project.directory,
              ...(await client.worktree.list({ projectID: location.project.id }, options)).map(
                (item) => item.directory,
              ),
            ].sort((a, b) => b.length - a.length)
          : undefined
        const query = {
          ...(location ? { project: location.project.id } : input.directory ? { directory: input.directory } : {}),
          workspace: input.workspace,
          parentID: input.roots ? null : undefined,
          search: input.search,
          limit,
        }
        const sessions: Array<ReturnType<typeof sessionView> & { worktreeName?: string }> = []
        let cursor: string | undefined
        do {
          const page = await client.session.list(cursor ? { cursor, limit } : query, options)
          for (const session of page.data) {
            if (!input.archived && session.time.archived !== undefined) continue
            const root = roots?.find((directory) => {
              const relative = path.relative(directory, session.location.directory)
              return (
                relative === "" ||
                (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
              )
            })
            sessions.push({
              ...sessionView(session),
              ...(roots ? { worktreeName: path.basename(root ?? session.location.directory) } : {}),
            })
            if (sessions.length === limit) break
          }
          cursor = page.data.length ? page.cursor.next ?? undefined : undefined
        } while (cursor && sessions.length < limit)
        return sessions
      }, options),
  }
}
