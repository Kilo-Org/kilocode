import { realpathSync } from "node:fs"
import path from "node:path"
import type { OpenCodeClient } from "@opencode/client"
import type { Mention, SessionSearchItem, ToWebview } from "../protocol"
import { exec } from "../util/process"

type Input = {
  client: OpenCodeClient | null
  message: Extract<Mention, { type: "requestSessionSearch" }>
  /** The host's own directory, for a request that names none. */
  directory: string
  /** The roots of the directory's worktree family. Defaults to `git worktree list`. */
  family?: (dir: string) => Promise<string[]>
  post: (message: ToWebview) => void
}

const LIMIT = 5_000

/**
 * Past-chat mention search. Lists the root sessions of the directory's worktree
 * family (the repo root and its sibling worktrees for git projects, just the
 * directory itself otherwise), the same family the Agent Manager session search
 * spans. Every session in the family shares the project, so any of them can be
 * attached regardless of which worktree the current chat runs in. Fuzzy title
 * filtering happens in the webview.
 */
export async function handleSessionSearch(input: Input): Promise<void> {
  const reply = (sessions: SessionSearchItem[]) =>
    input.post({ type: "sessionSearchResult", sessions, requestId: input.message.requestId })
  const client = input.client
  if (!client) return reply([])

  const dir = input.message.directory ?? input.directory
  try {
    const [location, roots] = await Promise.all([
      client.location.get({ location: { directory: dir } }),
      (input.family ?? worktreeFamily)(dir),
    ])
    const list = await client.session.list({
      project: location.project.id,
      parentID: null,
      archived: false,
      limit: LIMIT,
    })
    // Longest first, so a worktree nested in the repo names its own folder rather than the repo's.
    const sorted = roots.map(real).sort((a, b) => b.length - a.length)
    // Sessions share a few directories, so each one is resolved once.
    const resolved = new Map<string, string>()
    const resolve = (value: string) => {
      const known = resolved.get(value)
      if (known !== undefined) return known
      const next = real(value)
      resolved.set(value, next)
      return next
    }
    reply(
      list.data.flatMap((session) => {
        if (session.id === input.message.sessionID || !session.title) return []
        const place = resolve(session.location.directory)
        const root = sorted.find((item) => contains(item, place))
        if (!root) return []
        return [
          { id: session.id, title: session.title, updated: session.time.updated, worktreeName: path.basename(root) },
        ]
      }),
    )
  } catch (err) {
    console.error("[Kilo] Session search failed:", err)
    reply([])
  }
}

/**
 * The worktree family of a directory: every working tree `git worktree list` reports, plus the directory's own
 * top level (a submodule reports its gitdir instead of its working tree). Outside git, the directory alone.
 */
export async function worktreeFamily(dir: string): Promise<string[]> {
  const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: dir, timeout: 15_000 }).then(
    (result) => result.stdout.trim(),
    () => "",
  )
  if (!top) return [path.resolve(dir)]
  const listed = await exec("git", ["worktree", "list", "--porcelain"], { cwd: top, timeout: 15_000 }).then(
    (result) => result.stdout,
    () => "",
  )
  const dirs = listed
    .split("\n")
    .map((line) => line.trim())
    .flatMap((line) => (line.startsWith("worktree ") ? [path.resolve(line.slice("worktree ".length).trim())] : []))
  return [...new Set([...dirs, path.resolve(top)])]
}

// Git reports real paths, while a session keeps the directory it was opened with (on macOS, /tmp for /private/tmp).
function real(dir: string) {
  try {
    return realpathSync(dir)
  } catch {
    return path.resolve(dir)
  }
}

function contains(root: string, dir: string) {
  const relative = path.relative(root, dir)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}
