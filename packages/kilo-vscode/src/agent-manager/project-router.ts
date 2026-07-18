import type { Project } from "./project-registry"

/**
 * Read-only lookup against a project registry.
 *
 * Tests and the production router both use this minimal projection so the
 * pure resolver function below can be exercised without a real
 * `Memento` or `ProjectRegistryStore`.
 */
export interface ProjectLookup {
  get(id: string): Project | undefined
}

export type ProjectResolution =
  | { kind: "legacy"; root: string }
  | { kind: "project"; projectId: string; root: string }

export class ProjectUnknownError extends Error {
  override name = "ProjectUnknownError"
  constructor(public readonly projectId: string) {
    super(`Unknown project id: ${projectId}`)
  }
}

/**
 * Pure resolver: pick a registered project's root when `projectId` is set,
 * otherwise fall back to the supplied legacy root. Throws `ProjectUnknownError`
 * when the call cannot produce a root — including the case where the caller
 * set `projectId` but it does not resolve.
 */
export function resolveProjectRoot(
  lookup: ProjectLookup,
  projectId: string | undefined,
  legacyRoot: string | undefined,
): ProjectResolution {
  if (projectId && projectId.length > 0) {
    const project = lookup.get(projectId)
    if (!project) throw new ProjectUnknownError(projectId)
    return { kind: "project", projectId, root: project.root }
  }
  if (legacyRoot === undefined) throw new ProjectUnknownError("")
  return { kind: "legacy", root: legacyRoot }
}
