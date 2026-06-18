import type { KiloClient, SessionStatus } from "@kilocode/sdk/v2/client"
import { sameDirectory } from "../kilo-provider-utils"

export class SessionAbort {
  private active = new Map<string, Set<string>>()

  observe(sessionID: string, status: SessionStatus["type"], dir?: string) {
    if (!dir) return
    const dirs = this.active.get(sessionID)
    if (status === "idle") {
      if (!dirs) return
      for (const entry of dirs) {
        if (sameDirectory(entry, dir)) dirs.delete(entry)
      }
      if (dirs.size === 0) this.active.delete(sessionID)
      return
    }
    if (!dirs) {
      this.active.set(sessionID, new Set([dir]))
      return
    }
    if (![...dirs].some((entry) => sameDirectory(entry, dir))) dirs.add(dir)
  }

  preserve(sessionID: string, status: SessionStatus["type"] | undefined, dir: string) {
    if (!status || status === "idle" || this.active.has(sessionID)) return
    this.observe(sessionID, status, dir)
  }

  async stop(client: KiloClient, sessionID: string, fallback: string) {
    const known = this.active.has(sessionID)
    const dirs = [...(this.active.get(sessionID) ?? [])]
    if (!dirs.some((dir) => sameDirectory(dir, fallback))) dirs.push(fallback)
    const results = await Promise.allSettled(dirs.map((dir) => abortSession({ client, sessionID, dir })))
    const failures = results.flatMap((result, index) =>
      result.status === "rejected" ? [{ dir: dirs[index], error: result.reason }] : [],
    )
    if (failures.length > 0) {
      console.error("[Kilo New] KiloProvider: Failed to abort session in one or more directories:", failures)
      return false
    }
    if (known) this.active.delete(sessionID)
    return known
  }

  dispose(dir: string) {
    const idle: string[] = []
    for (const [sessionID, dirs] of this.active) {
      for (const entry of dirs) {
        if (sameDirectory(entry, dir)) dirs.delete(entry)
      }
      if (dirs.size > 0) continue
      this.active.delete(sessionID)
      idle.push(sessionID)
    }
    return idle
  }

  delete(sessionID: string) {
    this.active.delete(sessionID)
  }

  clear() {
    this.active.clear()
  }
}

export async function abortSession(input: { client: KiloClient; sessionID: string; dir: string }) {
  await input.client.session.abort({ sessionID: input.sessionID, directory: input.dir }, { throwOnError: true })
}
