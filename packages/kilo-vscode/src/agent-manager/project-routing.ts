import { ProjectRegistryStore } from "./project-registry-store"
import { type Project, type ProjectRegistry } from "./project-registry"
import { createProjectContext, type ProjectContext, type ProjectContextDeps } from "./project-context"
import { ProjectUnknownError, type ProjectResolution } from "./project-router"
import type { MementoLike } from "./host"
import {
  addProjectToRegistry,
  removeProjectFromRegistry,
  setProjectCollapsed,
  type AddProjectResult,
  type ParsedFolder,
  parseFolderInput,
  validateScheme,
} from "./project-add"
import { canonicalRoot as defaultCanonicalRoot } from "./project-canonical-root"

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
    /**
     * Optional override for the canonical-root resolver used by
     * `addProject`. Production wiring passes nothing; tests inject a stub to
     * avoid touching the filesystem or `git`.
     */
    private readonly canonicalRootOverride: (input: string) => Promise<string> = defaultCanonicalRoot,
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

  /** Resolve once `load()` has settled. Safe to call repeatedly. */
  loaded(): Promise<void> {
    return this.load() ?? Promise.resolve()
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

  // ---------------------------------------------------------------------------
  // Mutations (ticket #12353 — Add project flow + accordion sidebar)
  // ---------------------------------------------------------------------------

  /**
   * Validate the user-supplied folder input and return the parsed pieces
   * before canonicalization. Exposed so the host can preview the candidate
   * and surface an "unsupported scheme" error before the git invocation.
   */
  parseFolderInput(input: unknown): ParsedFolder {
    return parseFolderInput(input)
  }

  /** Same as {@link validateScheme} but re-exported through the routing seam. */
  validateFolder(folder: ParsedFolder) {
    return validateScheme(folder)
  }

  /**
   * Register a new project, dedup against the live registry by canonical
   * root, persist via `ProjectRegistryStore`, and dispose the previously
   * cached context if the registry already contained an entry under the
   * same root (idempotent dedup). Returns the resolved entry — either the
   * freshly added one or the pre-existing one.
   */
  async addProject(input: unknown): Promise<AddProjectResult> {
    const result = await addProjectToRegistry(input, {
      registry: this.registry,
      canonicalRoot: this.canonicalRootOverride,
      commit: async (next) => {
        await this.persist(next)
      },
    })
    if (result.ok && !result.deduplicated) {
      // Sync the in-memory snapshot so subsequent getProject() calls see the
      // new entry without waiting for a reload.
      this.registry = await this.readPersisted()
    }
    return result
  }

  /** Remove a project from the registry and dispose its cached context. */
  async removeProject(id: string): Promise<ProjectRegistry> {
    const next = removeProjectFromRegistry(this.registry, id)
    await this.persist(next)
    this.registry = next
    this.disposeProject(id)
    return next
  }

  /** Toggle the collapsed flag on a project's accordion header. */
  async toggleProjectCollapsed(id: string, collapsed?: boolean): Promise<ProjectRegistry> {
    const current = this.getProject(id)
    if (!current) return this.registry
    const next = setProjectCollapsed(this.registry, id, collapsed ?? !current.collapsed)
    await this.persist(next)
    this.registry = next
    return next
  }

  /** Persist the supplied registry through the store. */
  async persist(registry: ProjectRegistry): Promise<void> {
    const store = new ProjectRegistryStore(this.memento)
    await store.save(registry)
  }

  /** Re-read the registry from disk. Used by `addProject` after a fresh save. */
  private async readPersisted(): Promise<ProjectRegistry> {
    const store = new ProjectRegistryStore(this.memento)
    try {
      return await store.load()
    } catch {
      return EMPTY_REGISTRY
    }
  }
}
