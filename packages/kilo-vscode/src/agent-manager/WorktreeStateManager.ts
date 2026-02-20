/**
 * WorktreeStateManager - Centralized persistent state for agent manager worktrees and sessions.
 *
 * Persists to `.kilocode/agent-manager.json`. Decouples worktrees from sessions
 * (many sessions per worktree) and provides CRUD operations for both.
 *
 * Data model:
 * - Worktree: a git worktree with branch, path, parentBranch
 * - ManagedSession: a server session ID associated with a worktree (or null for local)
 */

import * as path from "path"
import * as fs from "fs"

export interface Worktree {
  id: string
  branch: string
  path: string
  parentBranch: string
  createdAt: string
}

export interface ManagedSession {
  id: string
  worktreeId: string | null
  createdAt: string
}

interface StateFile {
  worktrees: Record<string, Omit<Worktree, "id">>
  sessions: Record<string, Omit<ManagedSession, "id">>
}

const STATE_FILE = "agent-manager.json"
const KILOCODE_DIR = ".kilocode"

let counter = 0

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${++counter}`
}

export class WorktreeStateManager {
  private readonly file: string
  private worktrees = new Map<string, Worktree>()
  private sessions = new Map<string, ManagedSession>()
  private readonly log: (msg: string) => void
  private saving: Promise<void> | undefined
  private pendingSave = false

  constructor(root: string, log: (msg: string) => void) {
    this.file = path.join(root, KILOCODE_DIR, STATE_FILE)
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
    for (const wt of this.worktrees.values()) {
      if (wt.path === wtPath) return wt
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

  addWorktree(params: { branch: string; path: string; parentBranch: string }): Worktree {
    const id = generateId("wt")
    const wt: Worktree = { id, ...params, createdAt: new Date().toISOString() }
    this.worktrees.set(id, wt)
    this.log(`Added worktree ${id}: ${params.branch}`)
    void this.save()
    return wt
  }

  removeWorktree(id: string): ManagedSession[] {
    const removed = this.worktrees.delete(id)
    if (!removed) return []

    // Dissociate all sessions from this worktree (set worktreeId to null)
    const orphaned: ManagedSession[] = []
    for (const s of this.sessions.values()) {
      if (s.worktreeId === id) {
        s.worktreeId = null
        orphaned.push(s)
      }
    }

    this.log(`Removed worktree ${id}, orphaned ${orphaned.length} sessions`)
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

  /** Move an existing session to a worktree (promotion). */
  moveSession(sessionId: string, worktreeId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.worktreeId = worktreeId
    this.log(`Moved session ${sessionId} to worktree ${worktreeId}`)
    void this.save()
  }

  removeSession(id: string): void {
    this.sessions.delete(id)
    void this.save()
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  async load(): Promise<void> {
    try {
      const content = await fs.promises.readFile(this.file, "utf-8")
      const data = JSON.parse(content) as StateFile
      this.worktrees.clear()
      this.sessions.clear()

      for (const [id, wt] of Object.entries(data.worktrees ?? {})) {
        this.worktrees.set(id, { id, ...wt })
      }
      for (const [id, s] of Object.entries(data.sessions ?? {})) {
        this.sessions.set(id, { id, ...s })
      }
      this.log(`Loaded state: ${this.worktrees.size} worktrees, ${this.sessions.size} sessions`)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== "ENOENT") {
        this.log(`Failed to load state: ${error}`)
      }
    }
  }

  /** Remove worktrees whose directories no longer exist on disk. */
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
    if (changed) await this.save()
  }

  /** Wait for any in-flight save to complete without triggering a new one. */
  async flush(): Promise<void> {
    if (this.saving) await this.saving
  }

  async save(): Promise<void> {
    // Serialize concurrent saves — if a save is in-flight, queue one follow-up
    if (this.saving) {
      this.pendingSave = true
      await this.saving
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

    const dir = path.dirname(this.file)
    if (!fs.existsSync(dir)) await fs.promises.mkdir(dir, { recursive: true })
    await fs.promises.writeFile(this.file, JSON.stringify(data, null, 2), "utf-8")
  }
}
