/** Strict project/resource ownership for Agent Manager multi-project routing. */

import { zeroID as key } from "@opencode-ai/core/kilocode/zero-id"

export interface ProjectRef {
  projectId: string
}

export interface WorktreeRef extends ProjectRef {
  worktreeId: string
}

export interface SessionRef extends ProjectRef {
  sessionId: string
}

export type SidebarTarget =
  | { projectId: string; kind: "local" }
  | { projectId: string; kind: "worktree"; worktreeId: string }
  | { projectId: string; kind: "session"; sessionId: string }

export type ProjectRouteErrorCode =
  | "project_unknown"
  | "project_stale"
  | "worktree_unknown"
  | "session_unknown"
  | "session_ambiguous"

export class ProjectRouteError extends Error {
  constructor(
    readonly code: ProjectRouteErrorCode,
    message: string,
  ) {
    super(message)
  }
}

interface ProjectRoute {
  root: string
  generation: number
  worktrees: Map<string, string>
}

interface SessionRoute {
  projectId: string
  directory: string
  generation: number
}

export class ProjectRouteService {
  private readonly projects = new Map<string, ProjectRoute>()
  private readonly sessions = new Map<string, SessionRoute>()
  private readonly raw = new Map<string, Set<string>>()

  registerProject(projectId: string, root: string, generation: number): void {
    const current = this.projects.get(projectId)
    if (current && (current.generation !== generation || current.root !== root)) this.unregisterProject(projectId)
    if (current && current.generation === generation && current.root === root) return
    this.projects.set(projectId, { root, generation, worktrees: new Map() })
  }

  unregisterProject(projectId: string): void {
    this.projects.delete(projectId)
    for (const [id, route] of [...this.sessions]) {
      if (route.projectId !== projectId) continue
      this.sessions.delete(id)
      const sessionId = id.slice(id.indexOf("\0") + 1)
      const projects = this.raw.get(sessionId)
      projects?.delete(projectId)
      if (projects?.size === 0) this.raw.delete(sessionId)
    }
  }

  registerWorktree(ref: WorktreeRef, directory: string, generation: number): void {
    const project = this.requireProject(ref.projectId, generation)
    project.worktrees.set(ref.worktreeId, directory)
  }

  registerSession(ref: SessionRef, directory: string, generation: number): void {
    this.requireProject(ref.projectId, generation)
    this.sessions.set(key(ref.projectId, ref.sessionId), { projectId: ref.projectId, directory, generation })
    const projects = this.raw.get(ref.sessionId) ?? new Set<string>()
    projects.add(ref.projectId)
    this.raw.set(ref.sessionId, projects)
  }

  /**
   * Drop a single session route. Safe to call for unknown refs; never throws.
   * Keeps the raw index consistent so an unregistered id cannot remain
   * ambiguous or stale.
   */
  unregisterSession(ref: SessionRef): void {
    if (!this.sessions.delete(key(ref.projectId, ref.sessionId))) return
    const projects = this.raw.get(ref.sessionId)
    projects?.delete(ref.projectId)
    if (projects?.size === 0) this.raw.delete(ref.sessionId)
  }

  /** Whether a session route is currently registered for this ref. */
  hasSession(ref: SessionRef): boolean {
    return this.sessions.has(key(ref.projectId, ref.sessionId))
  }

  /**
   * Best-effort directory for a raw session id, without throwing.
   *
   * Returns the exact directory when the id maps to exactly one project,
   * `undefined` when unknown, and `undefined` when the id is ambiguous across
   * projects. Callers must NOT fall back to an arbitrary root for an
   * ambiguous id — that would silently retarget the operation to the wrong
   * project. Use {@link resolveRawSession} when a precise ref is required.
   */
  trySessionDirectory(sessionId: string): string | undefined {
    const projects = this.raw.get(sessionId)
    if (!projects?.size) return undefined
    if (projects.size > 1) return undefined
    const projectId = [...projects][0]!
    const route = this.sessions.get(key(projectId, sessionId))
    if (!route) return undefined
    if (!this.projects.has(projectId)) return undefined
    return route.directory
  }

  /** Whether a raw session id is known but maps to more than one project. */
  isSessionAmbiguous(sessionId: string): boolean {
    const projects = this.raw.get(sessionId)
    return !!projects && projects.size > 1
  }

  inheritSession(ref: SessionRef, parent: SessionRef): void {
    const route = this.requireSession(parent)
    if (ref.projectId !== parent.projectId) {
      throw new ProjectRouteError("session_unknown", "A child session cannot move between projects.")
    }
    this.registerSession(ref, route.directory, route.generation)
  }

  projectRoot(ref: ProjectRef, generation?: number): string {
    return this.requireProject(ref.projectId, generation).root
  }

  worktreeDirectory(ref: WorktreeRef, generation?: number): string {
    const project = this.requireProject(ref.projectId, generation)
    const directory = project.worktrees.get(ref.worktreeId)
    if (!directory) throw new ProjectRouteError("worktree_unknown", `Unknown worktree ${ref.worktreeId}.`)
    return directory
  }

  sessionDirectory(ref: SessionRef): string {
    return this.requireSession(ref).directory
  }

  /**
   * Non-throwing variant of {@link sessionDirectory}. Returns the exact
   * directory for a project-qualified session ref, or `undefined` when the
   * project or session is unknown. Used by the KiloProvider adapter to route
   * Agent Manager operations to an exact directory without risking an
   * exception in message-handling paths.
   */
  trySessionDirectoryFor(ref: SessionRef): string | undefined {
    const project = this.projects.get(ref.projectId)
    if (!project) return undefined
    const route = this.sessions.get(key(ref.projectId, ref.sessionId))
    if (!route) return undefined
    if (route.generation !== project.generation) return undefined
    return route.directory
  }

  resolveRawSession(sessionId: string): SessionRef {
    const projects = this.raw.get(sessionId)
    if (!projects?.size) throw new ProjectRouteError("session_unknown", `Unknown session ${sessionId}.`)
    if (projects.size > 1)
      throw new ProjectRouteError("session_ambiguous", `Session ${sessionId} exists in multiple projects.`)
    return { projectId: [...projects][0]!, sessionId }
  }

  static key(ref: ProjectRef & { sessionId?: string; worktreeId?: string }): string {
    const id = ref.sessionId ?? ref.worktreeId ?? "local"
    return key(ref.projectId, id)
  }

  private requireProject(projectId: string, generation?: number): ProjectRoute {
    const project = this.projects.get(projectId)
    if (!project) throw new ProjectRouteError("project_unknown", `Unknown project ${projectId}.`)
    if (generation !== undefined && generation !== project.generation) {
      throw new ProjectRouteError("project_stale", `Project ${projectId} has been replaced.`)
    }
    return project
  }

  private requireSession(ref: SessionRef): SessionRoute {
    const route = this.sessions.get(key(ref.projectId, ref.sessionId))
    if (!route) throw new ProjectRouteError("session_unknown", `Unknown session ${ref.sessionId} in ${ref.projectId}.`)
    this.requireProject(ref.projectId, route.generation)
    return route
  }
}
