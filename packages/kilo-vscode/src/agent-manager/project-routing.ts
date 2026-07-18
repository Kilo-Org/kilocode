import { ProjectRegistryStore } from "./project-registry-store"
import { type Project, type ProjectRegistry } from "./project-registry"
import {
  createProjectContext,
  type ProjectContext,
  type ProjectContextDeps,
} from "./project-context"
import { ProjectUnknownError, type ProjectResolution } from "./project-router"
import type { MementoLike } from "./host"

const EMPTY_REGISTRY: ProjectRegistry = { version: 1, projects: [] }

/**
 * Project routing coordinator owned by `AgentManagerProvider`.
 *
 * Responsibilities for the expand phase (ticket #12352):
 *
 * - Load the persisted `ProjectRegistry` from VS Code `globalState`.
 * - Lazily construct a `ProjectContext` per registered project on first
 *   reference and cache it in a `Map<projectId, ProjectContext>`.
 * - Dispose a project's context when it is removed from the registry.
 * - Resolve an incoming `projectId | undefined` to either the project's
 *   canonical root (when present) or the legacy `workspaceFolders[0]`
 *   root (when absent), surfacing `ProjectUnknownError` if a
 *   non-empty `projectId` does not resolve.
 *
 * The legacy path remains available: if no projects are registered, every
 * `resolveRoot()` call falls back to the supplied legacy root.
 */
export class ProjectRouting {
  private registry: ProjectRegistry = EMPTY_REGISTRY
  private readonly contexts = new Map<string, ProjectContext>()
  private loadPromise: Promise<void> | undefined

  constructor(
    private readonly memento: MementoLike,
    private readonly factory: (project: Project) => ProjectContextDeps,
    private readonly log: (msg: string) => void = () => {},
  ) {}

  /** Lazily load the persisted registry from `globalState`.
   *
   * A corrupt or schema-mismatched payload is treated as an empty registry:
   * expansion is a non-destructive phase and must not throw or block the
   * legacy single-project path. The error is forwarded to the `log`
   * callback so recovery prompts (a later ticket) have a hook to surface
   * the failure.
   */
  load(): Promise<void> {
    if (this.loadPromise) return this.loadPromise
    this.loadPromise = (async () => {
      const store = new ProjectRegistryStore(this.memento)
      try {
        this.registry = await store.load()
      } catch (err) {
        this.log(`Project registry could not be loaded: ${String(err)}`)
        this.registry = EMPTY_REGISTRY
      }
    })()
    return this.loadPromise
  }

  /** Eager snapshot accessor (used during construction before `load()` resolves). */
  snapshot(): ProjectRegistry {
    return this.registry
  }

  getProject(id: string): Project | undefined {
    return this.registry.projects.find((p) => p.id === id)
  }

  /** Lazily construct and cache a `ProjectContext` for the given id. */
  projectFor(id: string): ProjectContext | undefined {
    const existing = this.contexts.get(id)
    if (existing) return existing
    const project = this.getProject(id)
    if (!project) return undefined
    const deps = this.factory(project)
    const ctx = createProjectContext(project, deps)
    this.contexts.set(id, ctx)
    return ctx
  }

  /** Dispose and drop the cached context for a removed project. */
  disposeProject(id: string): void {
    const ctx = this.contexts.get(id)
    if (!ctx) return
    ctx.dispose()
    this.contexts.delete(id)
  }

  /** Tear down every cached context (used on provider disposal). */
  disposeAll(): void {
    for (const ctx of this.contexts.values()) ctx.dispose()
    this.contexts.clear()
  }

  /**
   * Resolve an incoming `projectId | undefined` against the live registry.
   *
   * - When `projectId` is a non-empty string that matches a registered
   *   project, the project's canonical root is returned.
   * - When `projectId` is absent (or the empty string), `legacyRoot` is
   *   used unchanged so today's single-project users see no behavior change.
   * - When `projectId` is supplied but does not resolve (even if
   *   `legacyRoot` happens to be present), this throws `ProjectUnknownError`.
   *   The webview cannot down-grade a missing-id rejection by piggybacking
   *   on the legacy fallback.
   */
  resolveRoot(projectId: string | undefined, legacyRoot: string | undefined): ProjectResolution {
    if (projectId && projectId.length > 0) {
      const project = this.getProject(projectId)
      if (project) return { kind: "project", projectId, root: project.root }
      throw new ProjectUnknownError(projectId)
    }
    if (legacyRoot === undefined) throw new ProjectUnknownError("")
    return { kind: "legacy", root: legacyRoot }
  }
}
