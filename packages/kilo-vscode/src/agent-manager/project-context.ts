import type { Project } from "./project-registry"

/**
 * Service contracts the project context owns. The exact implementations are
 * passed in by the provider so that the context stays vscode-free and unit
 * tests can supply fakes.
 *
 * `buildWorktreeManager` returns `unknown` rather than a concrete
 * `WorktreeManager` because the expand phase (#12352) only needs the
 * project context to expose the *fact* of a per-project manager; the
 * concrete shape lands in #12357.
 */
export interface ProjectContextDeps {
  buildWorktreeManager(): unknown
}

export interface ProjectContext {
  readonly id: string
  readonly root: string
  readonly trusted: boolean
  getWorktreeManager(): unknown
  dispose(): void
}

/**
 * Construct an immutable, lazily-initialized context for a single registered
 * project. The canonical root is locked at creation; the services owned by
 * the context are built on first access and reused for the lifetime of the
 * context.
 */
export function createProjectContext(project: Project, deps: ProjectContextDeps): ProjectContext {
  let worktreeManager: unknown
  let disposed = false

  return {
    id: project.id,
    root: project.root,
    trusted: project.trusted,
    getWorktreeManager() {
      if (disposed) return undefined
      if (worktreeManager === undefined) worktreeManager = deps.buildWorktreeManager()
      return worktreeManager
    },
    dispose() {
      if (disposed) return
      disposed = true
      worktreeManager = undefined
    },
  }
}
