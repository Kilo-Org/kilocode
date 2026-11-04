import type { AgentManagerConnection } from "./connection"
import type { ScriptTerminalManager } from "./ScriptTerminalManager"
import type { SessionTerminalManager } from "./SessionTerminalManager"
import type { TerminalRouter } from "./terminal-routing"

export async function block(target: string, blocked: Map<string, number>, creates?: Set<Promise<unknown>>) {
  blocked.set(target, (blocked.get(target) ?? 0) + 1)
  if (creates) await Promise.allSettled([...creates])
  let released = false
  return () => {
    if (released) return
    released = true
    const count = blocked.get(target)
    if (!count || count === 1) blocked.delete(target)
    else blocked.set(target, count - 1)
  }
}

/** True when the server reports that the PTY is already gone. */
export function ptyMissing(error: unknown, ptyID?: string): boolean {
  if (!error || typeof error !== "object") return false
  const value = error as Record<string, unknown>
  if (value._tag !== "PtyNotFoundError" && value.name !== "PtyNotFoundError") return false
  return ptyID === undefined || value.ptyID === undefined || value.ptyID === ptyID
}

/**
 * Kill the PTYs rooted in a worktree and dispose the directory's server
 * services.
 *
 * Evicting the location disposes its cached services, including every PTY the
 * directory owns, without booting anything for a directory that is about to be
 * deleted.
 */
export async function teardown(connection: AgentManagerConnection, directory: string): Promise<void> {
  const client = await connection.client()
  await client.debug.location.evict({ location: { directory } })
}

export async function acquirePtyCleanup(
  directory: string,
  input: {
    terminals: TerminalRouter
    integrated: SessionTerminalManager
    scripts: ScriptTerminalManager
    connection: AgentManagerConnection
  },
) {
  const releases = await Promise.all([input.terminals.blockDirectory(directory), input.scripts.blockDirectory(directory)])
  try {
    input.integrated.closeDirectory(directory)
    await input.terminals.closeDirectory(directory)
    await input.scripts.closeDirectory(directory)
    await teardown(input.connection, directory)
    let released = false
    return () => {
      if (released) return
      released = true
      for (const release of releases) release()
    }
  } catch (error) {
    for (const release of releases) release()
    throw error
  }
}