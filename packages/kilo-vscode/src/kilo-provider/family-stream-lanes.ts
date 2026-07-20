/**
 * Family stream lanes.
 *
 * Grants the scheduler's "visible" lane (~50ms) to every session in the
 * focused session's task family. Subagent sessions are discovered from task
 * tool parts and normally sit in the adaptive background lane (150-400ms),
 * which is right for sessions nobody watches — but the subagents of the
 * session you ARE watching should stream at near-parent cadence. The sidebar
 * only granted this when a task accordion was expanded, and Agent Manager
 * never expands accordions, so its subagents always rendered 10-25x slower
 * than their parent.
 *
 * Emissions must be ref-count compatible with VisibleTaskStreams (one
 * "visible" ref per grant, one "hidden" ref per revoke) so accordion-driven
 * visibility composes instead of clobbering.
 */
export class FamilyStreamLanes {
  private readonly parents = new Map<string, string>()
  private readonly grants = new Set<string>()
  private focused: string | undefined

  constructor(private readonly emit: (id: string, visible: boolean) => void) {}

  /** Record a child→parent link discovered from a task tool part. */
  link(child: string, parent: string | undefined): void {
    if (!parent || child === parent) return
    if (this.parents.get(child) === parent) return
    this.parents.set(child, parent)
    this.refresh()
  }

  focus(id: string | undefined): void {
    if (this.focused === id) return
    this.focused = id
    this.refresh()
  }

  delete(id: string): void {
    this.parents.delete(id)
    if (!this.grants.delete(id)) return
    this.emit(id, false)
  }

  /** Re-emit all active grants after the downstream ref store was reset. */
  reassert(): void {
    for (const id of this.grants) this.emit(id, true)
  }

  clear(): void {
    for (const id of this.grants) this.emit(id, false)
    this.grants.clear()
    this.parents.clear()
    this.focused = undefined
  }

  private reaches(id: string, root: string): boolean {
    let cur: string | undefined = id
    const seen = new Set<string>()
    while (cur && cur !== root && !seen.has(cur)) {
      seen.add(cur)
      cur = this.parents.get(cur)
    }
    return cur === root
  }

  private refresh(): void {
    const next = new Set<string>()
    if (this.focused) {
      for (const child of this.parents.keys()) {
        if (child === this.focused) continue
        if (this.reaches(child, this.focused)) next.add(child)
      }
    }
    for (const id of this.grants) {
      if (!next.has(id)) this.emit(id, false)
    }
    for (const id of next) {
      if (!this.grants.has(id)) this.emit(id, true)
    }
    this.grants.clear()
    for (const id of next) this.grants.add(id)
  }
}
