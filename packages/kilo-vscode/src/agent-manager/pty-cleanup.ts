import type { KiloClient } from "@kilocode/sdk/v2/client"
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

/**
 * Kill the backend PTYs rooted in a worktree and dispose its backend instance.
 *
 * Goes through the project root instance on purpose: a directory-scoped request for the
 * worktree would boot a backend instance for a directory that is about to be deleted, which
 * takes close to a second in large repositories when the instance is not loaded yet.
 */
export async function teardown(
  getClient: (directory: string) => Promise<KiloClient>,
  root: string | undefined,
  directory: string,
): Promise<void> {
  if (!root) throw new Error(`No project root to tear down ${directory}`)
  const client = await getClient(root)
  const result = await client.kilocode.teardownWorktree({ directory: root, worktree: directory })
  if (result.error) throw result.error
}

export async function acquirePtyCleanup(
  directory: string,
  root: string | undefined,
  input: {
    terminals: TerminalRouter
    integrated: SessionTerminalManager
    scripts: ScriptTerminalManager
    getClient: (directory: string) => Promise<KiloClient>
  },
) {
  const releases = await Promise.all([
    input.terminals.blockDirectory(directory),
    input.scripts.blockDirectory(directory),
  ])
  try {
    input.integrated.closeDirectory(directory)
    await input.terminals.closeDirectory(directory)
    await input.scripts.closeDirectory(directory)
    await teardown(input.getClient, root, directory)
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
