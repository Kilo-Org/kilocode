import { execGhRead } from "../gh"
import { GH_MUTATION_TIMEOUT } from "./pr-constants"
import { RESOLVE_THREAD_MUTATION, UNRESOLVE_THREAD_MUTATION } from "./graphql"

export async function resolveComment(threadId: string, cwd: string): Promise<void> {
  try {
    await execGhRead(["api", "graphql", "-f", `query=${RESOLVE_THREAD_MUTATION}`, "-F", `id=${threadId}`], {
      cwd,
      timeout: GH_MUTATION_TIMEOUT,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const stderr = (err as Record<string, unknown>).stderr
    throw new Error(`Could not resolve thread: ${msg}${stderr ? ` — ${stderr}` : ""}`)
  }
}

export async function unresolveComment(threadId: string, cwd: string): Promise<void> {
  try {
    await execGhRead(["api", "graphql", "-f", `query=${UNRESOLVE_THREAD_MUTATION}`, "-F", `id=${threadId}`], {
      cwd,
      timeout: GH_MUTATION_TIMEOUT,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const stderr = (err as Record<string, unknown>).stderr
    throw new Error(`Could not unresolve thread: ${msg}${stderr ? ` — ${stderr}` : ""}`)
  }
}
