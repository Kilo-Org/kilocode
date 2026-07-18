import { parseProjectRegistry, serializeProjectRegistry, type ProjectRegistry } from "./project-registry"
import type { MementoLike } from "./host"

export const PROJECT_REGISTRY_STORAGE_KEY = "kilo.agentManager.projectRegistry.v1"

export class ProjectRegistryStoreCorrupt extends Error {
  override name = "ProjectRegistryStoreCorrupt"
  constructor(
    public readonly cause: unknown,
    message: string,
  ) {
    super(message)
  }
}

/**
 * Persists the v1 project registry to a VS Code `Memento` slot.
 *
 * - `load()` reads and parses the JSON-serialized registry; a missing slot
 *   yields an empty registry so first-run callers do not have to special-case
 *   it.
 * - `save()` writes the serialized registry under the module-level storage
 *   key.
 * - Malformed or schema-mismatched payload raises
 *   `ProjectRegistryStoreCorrupt`, mirroring `parseProjectRegistry`'s
 *   structured errors so callers can distinguish "no projects yet" from
 *   "registry needs recovery".
 */
export class ProjectRegistryStore {
  constructor(private readonly state: MementoLike) {}

  async load(): Promise<ProjectRegistry> {
    const raw = this.state.get<string>(PROJECT_REGISTRY_STORAGE_KEY)
    if (raw === undefined) return { version: 1, projects: [] }
    try {
      return parseProjectRegistry(raw)
    } catch (err) {
      throw new ProjectRegistryStoreCorrupt(err, "Project registry payload is corrupt")
    }
  }

  async save(registry: ProjectRegistry): Promise<void> {
    await this.state.update(PROJECT_REGISTRY_STORAGE_KEY, serializeProjectRegistry(registry))
  }

  async clear(): Promise<void> {
    await this.state.update(PROJECT_REGISTRY_STORAGE_KEY, undefined)
  }
}
