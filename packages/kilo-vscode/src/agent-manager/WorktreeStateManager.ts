/**
 * WorktreeStateManager - Centralized persistent state for agent manager worktrees and sessions.
 *
 * Persists to `.kilo/agent-manager.json`. Decouples worktrees from sessions
 * (many sessions per worktree) and provides CRUD operations for both.
 *
 * Data model:
 * - Worktree: a git worktree with branch, path, parentBranch (bare), remote
 * - ManagedSession: a server session ID associated with a worktree (or null for local)
 */

import * as path from "path"
import * as fs from "fs"
import { normalizePath } from "./git-import"

export interface Worktree {
  id: string
  branch: string
  path: string
  /** Bare branch name (e.g. "main"), without remote prefix. */
  parentBranch: string
  /** Remote name (e.g. "origin"). When set, diffs compare against `${remote}/${parentBranch}`. */
  remote?: string
  createdAt: string
  /** Shared identifier for worktrees created together via multi-version mode. */
  groupId?: string
  /** User-provided display name for the worktree. */
  label?: string
  /** Cached PR number for instant badge display on reload. */
  prNumber?: number
  /** Cached PR URL for instant badge display on reload. */
  prUrl?: string
  /** Cached PR state for correct badge color on reload (open/merged/closed/draft). */
  prState?: string
  /** Original branch created with the worktree, used for cleanup on deletion.
   *  Set automatically when `branch` is updated via live sync. */
  originalBranch?: string
  /** Section this worktree belongs to, or undefined for ungrouped. */
  sectionId?: string
}

export interface Section {
  id: string
  name: string
  /** Color label (e.g. "Red", "Blue") mapped to VS Code theme CSS vars at render time, or null for default. */
  color: string | null
  /** Position among top-level sidebar children (sections and ungrouped worktrees). */
  order: number
  collapsed: boolean
}

/**
 * Construct the remote-prefixed ref for diff comparisons.
 * Returns `${remote}/${branch}` when a remote is known, otherwise the bare branch.
 * This mirrors Superset's pattern of always diffing against the remote tracking ref.
 */
export function remoteRef(wt: Pick<Worktree, "parentBranch" | "remote">): string {
  return wt.remote ? `${wt.remote}/${wt.parentBranch}` : wt.parentBranch
}

export interface ManagedSession {
  id: string
  worktreeId: string | null
  createdAt: string
}

interface StateFile {
  worktrees: Record<string, Omit<Worktree, "id">>
  sessions: Record<string, Omit<ManagedSession, "id">>
  sections?: Record<string, Omit<Section, "id">>
  tabOrder?: Record<string, string[]>
  worktreeOrder?: string[]
  sessionsCollapsed?: boolean
  reviewDiffStyle?: "unified" | "split"
  defaultBaseBranch?: string
}

import { KILO_DIR, migrateAgentManagerData, type MigrationResult } from "./constants"

const STATE_FILE = "agent-manager.json"

let counter = 0

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${++counter}`
}

export class WorktreeStateManager {
  private readonly file: string
  private worktrees = new Map<string, Worktree>()
  private sessions = new Map<string, ManagedSession>()
  private sections = new Map<string, Section>()
  private tabOrder: Record<string, string[]> = {}
  private worktreeOrder: string[] = []
  private collapsed = false
  private reviewDiffStyle: "unified" | "split" = "unified"
  private defaultBase: string | undefined
  private readonly log: (msg: string) => void
  private saving: Promise<void> | undefined
  private pendingSave = false

  private readonly root: string
  private migrated = false
  private loadFailed = false

  constructor(root: string, log: (msg: string) => void) {
    this.root = root
    this.file = path.join(root, KILO_DIR, STATE_FILE)
    this.log = log
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  getWorktrees(): Worktree[] {
    return [...this.worktrees.values()]
  }

  getWorktree(id: string): Worktree | undefined {
    return this.worktrees.get(id)
  }

  /** Find worktree by its filesystem path. */
  findWorktreeByPath(wtPath: string): Worktree | undefined {
    const target = normalizePath(wtPath)
    for (const wt of this.worktrees.values()) {
      if (normalizePath(wt.path) === target) return wt
    }
    return undefined
  }

  getSessions(worktreeId?: string): ManagedSession[] {
    const all = [...this.sessions.values()]
    if (worktreeId === undefined) return all
    return all.filter((s) => s.worktreeId === worktreeId)
  }

  getSession(id: string): ManagedSession | undefined {
    return this.sessions.get(id)
  }

  /** Returns the worktree directory for a session, or undefined for local sessions. */
  directoryFor(sessionId: string): string | undefined {
    const session = this.sessions.get(sessionId)
    if (!session?.worktreeId) return undefined
    return this.worktrees.get(session.worktreeId)?.path
  }

  /** Returns all session IDs that belong to any worktree. */
  worktreeSessionIds(): Set<string> {
    const ids = new Set<string>()
    for (const s of this.sessions.values()) {
      if (s.worktreeId) ids.add(s.id)
    }
    return ids
  }

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  addWorktree(params: {
    branch: string
    path: string
    parentBranch: string
    remote?: string
    groupId?: string
    label?: string
  }): Worktree {
    const id = generateId("wt")
    const wt: Worktree = {
      id,
      branch: params.branch,
      path: params.path,
      parentBranch: params.parentBranch,
      createdAt: new Date().toISOString(),
    }
    if (params.remote) wt.remote = params.remote
    if (params.groupId) wt.groupId = params.groupId
    if (params.label) wt.label = params.label
    this.worktrees.set(id, wt)
    this.setNormalizedWorktreeOrder(this.worktreeOrder)
    this.log(
      `Added worktree ${id}: ${params.branch}${params.label ? ` (label=${params.label})` : ""}${params.groupId ? ` (group=${params.groupId})` : ""}`,
    )
    void this.save()
    return wt
  }

  updateWorktreeBranch(id: string, branch: string): boolean {
    const wt = this.worktrees.get(id)
    if (!wt || wt.branch === branch) return false
    if (!wt.originalBranch) wt.originalBranch = wt.branch
    this.log(`Updated worktree ${id} branch: ${wt.branch} → ${branch}`)
    wt.branch = branch
    void this.save()
    return true
  }

  updateWorktreeLabel(id: string, label: string): void {
    const wt = this.worktrees.get(id)
    if (!wt) return
    wt.label = label || undefined
    this.log(`Updated worktree ${id} label to "${label}"`)
    void this.save()
  }

  updateWorktreePR(id: string, prNumber?: number, prUrl?: string, prState?: string): void {
    const wt = this.worktrees.get(id)
    if (!wt) return
    if (wt.prNumber === prNumber && wt.prUrl === prUrl && wt.prState === prState) return
    wt.prNumber = prNumber
    wt.prUrl = prUrl
    wt.prState = prState
    void this.save()
  }

  removeWorktree(id: string): ManagedSession[] {
    const removed = this.worktrees.delete(id)
    if (!removed) return []

    // Collect and remove all sessions belonging to this worktree
    const orphaned: ManagedSession[] = []
    for (const s of this.sessions.values()) {
      if (s.worktreeId === id) {
        orphaned.push({ ...s })
        this.sessions.delete(s.id)
      }
    }

    // Clean up tab order for this worktree
    delete this.tabOrder[id]

    this.setNormalizedWorktreeOrder(this.worktreeOrder.filter((item) => item !== id))

    this.log(`Removed worktree ${id}, removed ${orphaned.length} sessions`)
    void this.save()
    return orphaned
  }

  addSession(sessionId: string, worktreeId: string | null): ManagedSession {
    const session: ManagedSession = { id: sessionId, worktreeId, createdAt: new Date().toISOString() }
    this.sessions.set(sessionId, session)
    this.log(`Added session ${sessionId} to worktree ${worktreeId ?? "local"}`)
    void this.save()
    return session
  }

  /** Move an existing session to a worktree (or back to local when null). */
  moveSession(sessionId: string, worktreeId: string | null): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.worktreeId = worktreeId
    this.log(`Moved session ${sessionId} to ${worktreeId ?? "local"}`)
    void this.save()
  }

  removeSession(id: string): void {
    this.sessions.delete(id)

    // Remove this session from any tab order arrays
    for (const [key, order] of Object.entries(this.tabOrder)) {
      const idx = order.indexOf(id)
      if (idx !== -1) {
        order.splice(idx, 1)
        if (order.length === 0) delete this.tabOrder[key]
      }
    }

    void this.save()
  }

  // ---------------------------------------------------------------------------
  // Tab order
  // ---------------------------------------------------------------------------

  getTabOrder(): Record<string, string[]> {
    return this.tabOrder
  }

  setTabOrder(key: string, order: string[]): void {
    this.tabOrder[key] = order
    void this.save()
  }

  removeTabOrder(key: string): void {
    delete this.tabOrder[key]
    void this.save()
  }

  // ---------------------------------------------------------------------------
  // Worktree order
  // ---------------------------------------------------------------------------

  getWorktreeOrder(): string[] {
    return this.worktreeOrder
  }

  setWorktreeOrder(order: string[]): void {
    this.setNormalizedWorktreeOrder(order)
    void this.save()
  }

  private setNormalizedWorktreeOrder(order: string[]): boolean {
    const valid = new Set<string>()
    for (const sec of this.sections.values()) valid.add(sec.id)
    for (const wt of this.worktrees.values()) valid.add(wt.id)

    const result: string[] = []
    const seen = new Set<string>()
    const add = (id: string) => {
      if (!valid.has(id) || seen.has(id)) return
      result.push(id)
      seen.add(id)
    }

    for (const id of order) add(id)
    for (const sec of [...this.sections.values()].sort((a, b) => a.order - b.order)) add(sec.id)
    for (const wt of this.worktrees.values()) add(wt.id)

    const changed =
      result.length !== this.worktreeOrder.length || result.some((id, idx) => id !== this.worktreeOrder[idx])
    this.worktreeOrder = result
    return this.syncSectionOrder() || changed
  }

  private syncSectionOrder(): boolean {
    const top = this.worktreeOrder.filter((id) => {
      if (this.sections.has(id)) return true
      const wt = this.worktrees.get(id)
      return !!wt && !wt.sectionId
    })
    const index = new Map(top.map((id, idx) => [id, idx] as const))
    const changes = [...this.sections.values()].map((sec) => {
      const order = index.get(sec.id)
      if (order === undefined || sec.order === order) return false
      sec.order = order
      return true
    })
    return changes.some(Boolean)
  }

  // ---------------------------------------------------------------------------
  // Sections
  // ---------------------------------------------------------------------------

  getSections(): Section[] {
    return [...this.sections.values()].sort((a, b) => a.order - b.order)
  }

  getSection(id: string): Section | undefined {
    return this.sections.get(id)
  }

  /** Return IDs of worktrees assigned to the given section. */
  getWorktreesInSection(id: string): string[] {
    const result: string[] = []
    for (const wt of this.worktrees.values()) {
      if (wt.sectionId === id) result.push(wt.id)
    }
    return result
  }

  addSection(name: string, color: string | null, worktreeIds?: string[]): Section {
    this.setNormalizedWorktreeOrder(this.worktreeOrder)
    const id = generateId("sec")
    const order = this.worktreeOrder.filter((item) => {
      if (this.sections.has(item)) return true
      const wt = this.worktrees.get(item)
      return !!wt && !wt.sectionId
    }).length
    const sec: Section = { id, name, color, order, collapsed: false }
    this.sections.set(id, sec)
    this.worktreeOrder.push(id)
    if (worktreeIds) {
      for (const wtId of worktreeIds) {
        const wt = this.worktrees.get(wtId)
        if (wt) wt.sectionId = id
      }
    }
    this.setNormalizedWorktreeOrder(this.worktreeOrder)
    this.log(`Added section ${id}: "${name}"`)
    void this.save()
    return sec
  }

  renameSection(id: string, name: string): void {
    const sec = this.sections.get(id)
    if (!sec || !name) return
    sec.name = name
    this.log(`Renamed section ${id} to "${name}"`)
    void this.save()
  }

  setSectionColor(id: string, color: string | null): void {
    const sec = this.sections.get(id)
    if (!sec) return
    sec.color = color
    void this.save()
  }

  toggleSection(id: string): void {
    const sec = this.sections.get(id)
    if (!sec) return
    sec.collapsed = !sec.collapsed
    void this.save()
  }

  deleteSection(id: string): void {
    if (!this.sections.delete(id)) return
    // Ungroup all worktrees in this section — do NOT delete them
    for (const wt of this.worktrees.values()) {
      if (wt.sectionId === id) wt.sectionId = undefined
    }
    this.setNormalizedWorktreeOrder(this.worktreeOrder.filter((item) => item !== id))
    this.log(`Deleted section ${id}, ungrouped its worktrees`)
    void this.save()
  }

  moveSection(id: string, dir: -1 | 1): void {
    const repaired = this.setNormalizedWorktreeOrder(this.worktreeOrder)
    const top = this.worktreeOrder.filter((item) => {
      if (this.sections.has(item)) return true
      const wt = this.worktrees.get(item)
      return !!wt && !wt.sectionId
    })
    const idx = top.indexOf(id)
    const next = idx + dir
    if (idx === -1 || next < 0 || next >= top.length) {
      if (repaired) void this.save()
      return
    }
    const target = top[next]!
    const result = [...this.worktreeOrder]
    const fi = result.indexOf(id)
    if (fi === -1 || result.indexOf(target) === -1) {
      if (repaired) void this.save()
      return
    }
    result.splice(fi, 1)
    const insertAt = result.indexOf(target) + (dir === 1 ? 1 : 0)
    result.splice(insertAt, 0, id)
    this.setNormalizedWorktreeOrder(result)
    void this.save()
  }

  moveToSection(worktreeIds: string[], sectionId: string | null): void {
    // Expand to include all multi-version siblings (same groupId)
    const expanded = new Set(worktreeIds)
    for (const wtId of worktreeIds) {
      const wt = this.worktrees.get(wtId)
      if (!wt?.groupId) continue
      for (const sibling of this.worktrees.values()) {
        if (sibling.groupId === wt.groupId) expanded.add(sibling.id)
      }
    }
    for (const wtId of expanded) {
      const wt = this.worktrees.get(wtId)
      if (!wt) continue
      wt.sectionId = sectionId ?? undefined
    }
    this.setNormalizedWorktreeOrder(this.worktreeOrder)
    void this.save()
  }

  // ---------------------------------------------------------------------------
  // Sessions collapsed
  // ---------------------------------------------------------------------------

  getSessionsCollapsed(): boolean {
    return this.collapsed
  }

  setSessionsCollapsed(value: boolean): void {
    this.collapsed = value
    void this.save()
  }

  // ---------------------------------------------------------------------------
  // Review diff style
  // ---------------------------------------------------------------------------

  getReviewDiffStyle(): "unified" | "split" {
    return this.reviewDiffStyle
  }

  setReviewDiffStyle(value: "unified" | "split"): void {
    this.reviewDiffStyle = value
    void this.save()
  }

  // ---------------------------------------------------------------------------
  // Default base branch
  // ---------------------------------------------------------------------------

  getDefaultBaseBranch(): string | undefined {
    return this.defaultBase
  }

  setDefaultBaseBranch(value: string | undefined): void {
    this.defaultBase = value
    void this.save()
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  async load(): Promise<MigrationResult> {
    // Migrate Agent Manager data from .kilocode → .kilo before first read
    let migration: MigrationResult = { refsFixed: 0 }
    if (!this.migrated) {
      this.migrated = true
      migration = await migrateAgentManagerData(this.root, this.log)
    }
    try {
      const content = await fs.promises.readFile(this.file, "utf-8")
      this.apply(content)
      this.loadFailed = false
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === "ENOENT") this.loadFailed = false
      if (code !== "ENOENT") {
        this.log(`Failed to load state: ${error}`)
        this.loadFailed = true
      }
    }
    return migration
  }

  private apply(content: string): void {
    const data = JSON.parse(content) as StateFile
    this.worktrees.clear()
    this.sessions.clear()
    this.sections.clear()
    this.tabOrder = {}
    this.worktreeOrder = []
    this.reviewDiffStyle = "unified"

    for (const [id, wt] of Object.entries(data.worktrees ?? {})) {
      // Rewrite stale .kilocode paths while preserving the separator style already stored.
      const fixed =
        wt.path?.replace(/([/\\])\.kilocode([/\\])/g, (_match, leadingSep, trailingSep) => {
          return `${leadingSep}.kilo${trailingSep}`
        }) ?? wt.path
      this.worktrees.set(id, { id, ...wt, path: fixed })
    }
    let pruned = 0
    for (const [id, s] of Object.entries(data.sessions ?? {})) {
      const ref = s.worktreeId
      if (ref === null) {
        this.sessions.set(id, { id, ...s })
        continue
      }
      // Skip orphaned sessions referencing a deleted worktree.
      if (!ref || !this.worktrees.has(ref)) {
        pruned++
        continue
      }
      this.sessions.set(id, { id, ...s })
    }
    for (const [id, sec] of Object.entries(data.sections ?? {})) {
      this.sections.set(id, { id, ...sec })
    }
    if (data.tabOrder) {
      this.tabOrder = data.tabOrder
    }
    if (data.worktreeOrder) {
      this.worktreeOrder = data.worktreeOrder
    }
    const repaired = this.setNormalizedWorktreeOrder(this.worktreeOrder)
    this.collapsed = data.sessionsCollapsed ?? false
    if (data.reviewDiffStyle === "split") {
      this.reviewDiffStyle = "split"
    }
    this.defaultBase = data.defaultBaseBranch
    this.log(`Loaded state: ${this.worktrees.size} worktrees, ${this.sessions.size} sessions`)
    if (pruned > 0 || repaired) {
      if (pruned > 0) this.log(`Pruned ${pruned} orphaned sessions`)
      void this.save()
    }
  }

  /** Remove worktrees whose directories no longer exist on disk and prune orphaned sessions. */
  async validate(root: string): Promise<void> {
    let changed = false
    for (const wt of [...this.worktrees.values()]) {
      const resolved = path.isAbsolute(wt.path) ? wt.path : path.join(root, wt.path)
      if (!fs.existsSync(resolved)) {
        this.log(`Worktree ${wt.id} directory missing (${resolved}), removing`)
        this.removeWorktree(wt.id)
        changed = true
      }
    }
    // Preserve local sessions; prune only sessions that reference missing worktrees.
    for (const s of [...this.sessions.values()]) {
      const ref = s.worktreeId
      if (ref === null) continue
      if (!ref || !this.worktrees.has(ref)) {
        this.sessions.delete(s.id)
        changed = true
      }
    }
    if (changed) {
      this.log(`Pruned orphaned sessions during validation`)
      await this.save()
    }
  }

  /** Wait for any in-flight save to complete without triggering a new one. */
  async flush(): Promise<void> {
    if (this.saving) await this.saving
  }

  async save(): Promise<void> {
    if (this.loadFailed) {
      this.log("Skipping save because state failed to load")
      return
    }

    // Serialize concurrent saves — if a save is in-flight, queue one follow-up
    if (this.saving) {
      this.pendingSave = true
      await this.saving
      // The in-flight save finished but our data may not have been written yet.
      // If there's a new save already running (the pendingSave follow-up), wait for it.
      if (this.saving) await this.saving
      return
    }

    this.saving = this.writeToDisk()
    try {
      await this.saving
    } finally {
      this.saving = undefined
    }

    // If another save was requested while we were writing, flush it now
    if (this.pendingSave) {
      this.pendingSave = false
      await this.save()
    }
  }

  private async writeToDisk(): Promise<void> {
    const data: StateFile = { worktrees: {}, sessions: {} }
    for (const [id, wt] of this.worktrees) {
      const { id: _, ...rest } = wt
      data.worktrees[id] = rest
    }
    for (const [id, s] of this.sessions) {
      const { id: _, ...rest } = s
      data.sessions[id] = rest
    }
    if (this.sections.size > 0) {
      data.sections = {}
      for (const [id, sec] of this.sections) {
        const { id: _, ...rest } = sec
        data.sections[id] = rest
      }
    }
    if (Object.keys(this.tabOrder).length > 0) {
      data.tabOrder = this.tabOrder
    }
    if (this.worktreeOrder.length > 0) {
      data.worktreeOrder = this.worktreeOrder
    }
    if (this.collapsed) {
      data.sessionsCollapsed = true
    }
    if (this.reviewDiffStyle === "split") {
      data.reviewDiffStyle = "split"
    }
    if (this.defaultBase) {
      data.defaultBaseBranch = this.defaultBase
    }

    const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`
    try {
      const dir = path.dirname(this.file)
      if (!fs.existsSync(dir)) await fs.promises.mkdir(dir, { recursive: true })
      const content = JSON.stringify(data, null, 2)
      await fs.promises.writeFile(tmp, content, "utf-8")
      await fs.promises.rename(tmp, this.file)
    } catch (error) {
      await fs.promises.rm(tmp, { force: true }).catch((err) => this.log(`Failed to remove temp state file: ${err}`))
      const code = (error as NodeJS.ErrnoException).code
      if (code === "ENOENT") {
        this.log("State directory was removed, skipping save")
        return
      }
      throw error
    }
  }
}
