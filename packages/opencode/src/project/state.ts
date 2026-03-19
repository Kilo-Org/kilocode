import { Log } from "@/util/log"

export namespace State {
  interface Entry {
    state: any
    dispose?: (state: any) => Promise<void>
  }

  const log = Log.create({ service: "state" })
  const recordsByKey = new Map<string, Map<any, Entry>>()
  // kilocode_change start
  const groups = new Map<string, Set<any>>()
  // kilocode_change end

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

      const task = Promise.resolve(entry.state)
        .then((state) => entry.dispose!(state))
        .catch((error) => {
          log.error("Error while disposing state:", { error, key, init: label })
        })

      tasks.push(task)
    }
    await Promise.all(tasks)

    entries.clear()
    recordsByKey.delete(key)

    disposalFinished = true
    log.info("state disposal completed", { key })
  }

  /**
   * Remove entries across all directories that were registered with the given
   * init function. Unlike dispose(), this does NOT call dispose callbacks —
   * the entry is simply dropped so the next access re-initialises it lazily.
   */
  export function removeByInit(init: any) {
    for (const entries of recordsByKey.values()) {
      entries.delete(init)
    }
  }

  // kilocode_change start
  /** Register an init function under a named group for bulk invalidation. */
  export function register(group: string, init: any) {
    let set = groups.get(group)
    if (!set) {
      set = new Set()
      groups.set(group, set)
    }
    set.add(init)
  }

  /**
   * Remove all entries in a named group across all directories.
   * Entries that registered a dispose callback are properly disposed before
   * removal so resources (e.g. MCP child processes) are cleaned up.
   */
  export async function invalidateGroup(group: string) {
    const inits = groups.get(group)
    if (!inits) return
    const tasks: Promise<void>[] = []
    for (const init of inits) {
      for (const entries of recordsByKey.values()) {
        const entry = entries.get(init)
        if (!entry) continue
        if (entry.dispose) {
          tasks.push(
            Promise.resolve(entry.state)
              .then((resolved) => entry.dispose!(resolved))
              .catch((error) => {
                log.error("dispose failed during group invalidation", { error })
              }),
          )
        }
        entries.delete(init)
      }
    }
    if (tasks.length) await Promise.all(tasks)
  }
  // kilocode_change end
}
