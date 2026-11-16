// The working tree change counts of the sidebar Changes button. One git read covers staged, unstaged and untracked
// changes, and the poller pushes a change, so a visible button follows the working tree without the webview asking.
import { GitOps } from "./agent-manager/GitOps"
import type { GitChangesStats } from "./protocol"

const INTERVAL_MS = 5000

export type GitChanges = {
  /** The latest counts, or one fresh read when the poller has not measured yet. Absent outside a git repository. */
  read(): Promise<GitChangesStats | undefined>
  /** Polls only while the view that shows the counts is visible. */
  setVisible(visible: boolean): void
  dispose(): void
}

/**
 * Creates the stats source of one view. `onStats` receives every change, so the host pushes `gitChangesStats` instead
 * of the webview polling. A directory that is not a git repository reports undefined and sends no update.
 */
export function gitChanges(input: {
  directory: string
  onStats: (stats: GitChangesStats | undefined) => void
  log?: (text: string) => void
}): GitChanges {
  const git = new GitOps({ log: () => {} })
  let timer: ReturnType<typeof setTimeout> | undefined
  let active = false
  let generation = 0
  let latest: GitChangesStats | undefined

  const read = () => git.workingTreeStats(input.directory)

  const same = (left: GitChangesStats | undefined, right: GitChangesStats | undefined) =>
    left?.files === right?.files &&
    left?.additions === right?.additions &&
    left?.deletions === right?.deletions

  const publish = (value: GitChangesStats | undefined) => {
    // A read that finishes after the view hid or disposed must not push into a webview that is gone. It must not count
    // as shown either, or the first read after the view shows again would match it and push nothing.
    if (!active) return
    if (same(latest, value)) return
    latest = value
    input.onStats(value)
  }

  const measure = () =>
    read().then(
      (value) => publish(value),
      (error: unknown) => {
        input.log?.(`Failed to read the working tree stats: ${String(error)}`)
        publish(undefined)
      },
    )

  const schedule = (current: number) => {
    if (!active || current !== generation) return
    timer = setTimeout(() => void tick(current), INTERVAL_MS)
  }

  const tick = async (current: number) => {
    if (!active || current !== generation) return
    await measure()
    schedule(current)
  }

  return {
    read: () => (latest ? Promise.resolve(latest) : read().catch(() => undefined)),
    setVisible(next) {
      if (active === next) return
      active = next
      generation++
      const current = generation
      if (timer) {
        clearTimeout(timer)
        timer = undefined
      }
      if (next) void tick(current)
    },
    dispose() {
      active = false
      generation++
      if (timer) clearTimeout(timer)
      timer = undefined
      git.dispose()
    },
  }
}

/**
 * One working-tree poller per directory, shared by every chat surface that shows its counts. Each surface keeps the
 * visibility rule of one view: the poller runs while at least one of them is visible, and stops when the last
 * subscriber disposes.
 */
export function createSharedGitStats(input: {
  directory: string
  /** Test seam: the per-source poller. */
  create?: (input: { directory: string; onStats: (stats: GitChangesStats | undefined) => void }) => GitChanges
}) {
  const listeners = new Map<symbol, (stats: GitChangesStats | undefined) => void>()
  const visible = new Map<symbol, boolean>()
  let source: GitChanges | undefined
  let running = false
  const anyVisible = () => [...visible.values()].some(Boolean)
  const poller = () => {
    source ??= (input.create ?? gitChanges)({
      directory: input.directory,
      onStats: (value) => listeners.forEach((listener) => listener(value)),
    })
    return source
  }
  /** Starts or stops the poller only when the combined visibility of the subscribers changes. */
  const sync = () => {
    const next = anyVisible()
    if (next === running) return
    running = next
    if (next) poller().setVisible(true)
    else source?.setVisible(false)
  }
  return (onStats: (stats: GitChangesStats | undefined) => void): GitChanges => {
    const id = Symbol("gitStats")
    listeners.set(id, onStats)
    visible.set(id, false)
    return {
      read: () => poller().read(),
      setVisible(next) {
        visible.set(id, next)
        sync()
      },
      dispose() {
        listeners.delete(id)
        visible.delete(id)
        sync()
        if (listeners.size > 0) return
        source?.dispose()
        source = undefined
        running = false
      },
    }
  }
}
