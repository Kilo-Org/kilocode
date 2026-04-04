import { Log } from "@/util/log"

export namespace State {
  interface Entry {
    state: any
    dispose?: (state: any) => Promise<void>
  }

  const log = Log.create({ service: "state" })
  const recordsByKey = new Map<string, Map<any, Entry>>()

  export function create<S>(root: () => string, init: () => S, dispose?: (state: Awaited<S>) => Promise<void>) {
    return () => {
      const key = root()
      let entries = recordsByKey.get(key)
      if (!entries) {
        entries = new Map<string, Entry>()
        recordsByKey.set(key, entries)
      }
      const exists = entries.get(init)
      if (exists) return exists.state as S
      const state = init()
      entries.set(init, {
        state,
        dispose,
      })
      return state
    }
  }

  /**
   * Remove a specific state entry without running its dispose callback.
   * The next call to the accessor will re-initialize from scratch.
   * Used to invalidate config-derived caches (e.g. Config.state) without
   * triggering a full Instance.dispose() that would kill running sessions.
   */
  export function resetEntry(key: string, init: (...args: any[]) => any) {
    recordsByKey.get(key)?.delete(init)
  }

  export async function dispose(key: string) {
    const entries = recordsByKey.get(key)
    if (!entries) return

    log.info("waiting for state disposal to complete", { key })

    let disposalFinished = false

    setTimeout(() => {
      if (!disposalFinished) {
        log.warn(
          "state disposal is taking an unusually long time - if it does not complete in a reasonable time, please report this as a bug",
          { key },
        )
      }
    }, 10000).unref()

    const tasks: Promise<void>[] = []
    for (const [init, entry] of entries) {
      if (!entry.dispose) continue

      const label = typeof init === "function" ? init.name : String(init)

      // kilocode_change start — hard timeout per disposer so a single hung callback
      // (e.g. MCP client.close()) cannot block the entire disposal indefinitely.
      // This is a backend safety bound, not a UI timeout: desktop, VS Code, and
      // other callers all wait on State.dispose() through Instance.disposeAll().
      // The race only stops waiting after 15 s; it does not cancel the underlying
      // disposer. That is still acceptable here because the important recovery step
      // is letting State.dispose() continue to entries.clear()/recordsByKey.delete()
      // so the next state access re-initializes from fresh config instead of hanging.
      const task = Promise.race([
        Promise.resolve(entry.state).then((state) => entry.dispose!(state)),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`state disposer "${label}" timed out after 15 s`)), 15_000).unref(),
        ),
      ]).catch((error) => {
        log.error("Error while disposing state:", { error, key, init: label })
      })
      // kilocode_change end

      tasks.push(task)
    }
    await Promise.all(tasks)

    entries.clear()
    recordsByKey.delete(key)

    disposalFinished = true
    log.info("state disposal completed", { key })
  }
}
