export const PROJECT_REGISTRY_VERSION = 1 as const
export type ProjectRegistryVersion = typeof PROJECT_REGISTRY_VERSION

export interface Project {
  id: string
  root: string
  label?: string
  order: number
  collapsed: boolean
  trusted: boolean
  trustedAt?: string
  lastActiveAt?: string
  lastSelectedContextId?: string
  defaultBaseBranch?: string
}

export interface ProjectRegistry {
  version: ProjectRegistryVersion
  projects: Project[]
  activeProjectId?: string
}

export class UnknownProjectRegistryVersionError extends Error {
  override name = "UnknownProjectRegistryVersionError"
  constructor(public readonly version: unknown) {
    super(`Project registry version ${String(version)} is not supported`)
  }
}

export class InvalidProjectRegistryError extends Error {
  override name = "InvalidProjectRegistryError"
  constructor(public readonly reason: string) {
    super(`Invalid project registry: ${reason}`)
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function parseOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string") throw new InvalidProjectRegistryError(`${field} must be a string when present`)
  return value
}

export function parseProject(raw: unknown): Project {
  if (!isPlainRecord(raw)) throw new InvalidProjectRegistryError("project must be an object")
  if (typeof raw.id !== "string") throw new InvalidProjectRegistryError("project.id must be a string")
  if (typeof raw.root !== "string") throw new InvalidProjectRegistryError("project.root must be a string")
  if (typeof raw.order !== "number") throw new InvalidProjectRegistryError("project.order must be a number")
  if (typeof raw.collapsed !== "boolean") throw new InvalidProjectRegistryError("project.collapsed must be a boolean")
  if (typeof raw.trusted !== "boolean") throw new InvalidProjectRegistryError("project.trusted must be a boolean")
  return {
    id: raw.id,
    root: raw.root,
    order: raw.order,
    collapsed: raw.collapsed,
    trusted: raw.trusted,
    label: parseOptionalString(raw.label, "project.label"),
    trustedAt: parseOptionalString(raw.trustedAt, "project.trustedAt"),
    lastActiveAt: parseOptionalString(raw.lastActiveAt, "project.lastActiveAt"),
    lastSelectedContextId: parseOptionalString(raw.lastSelectedContextId, "project.lastSelectedContextId"),
    defaultBaseBranch: parseOptionalString(raw.defaultBaseBranch, "project.defaultBaseBranch"),
  }
}

export function serializeProject(project: Project): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: project.id,
    root: project.root,
    order: project.order,
    collapsed: project.collapsed,
    trusted: project.trusted,
  }
  if (project.label !== undefined) out.label = project.label
  if (project.trustedAt !== undefined) out.trustedAt = project.trustedAt
  if (project.lastActiveAt !== undefined) out.lastActiveAt = project.lastActiveAt
  if (project.lastSelectedContextId !== undefined) out.lastSelectedContextId = project.lastSelectedContextId
  if (project.defaultBaseBranch !== undefined) out.defaultBaseBranch = project.defaultBaseBranch
  return out
}

export function parseProjectRegistry(raw: string): ProjectRegistry {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    if (err instanceof SyntaxError) throw new InvalidProjectRegistryError("registry must be valid JSON")
    throw err
  }
  if (!isPlainRecord(parsed)) throw new InvalidProjectRegistryError("registry must be an object")
  if (parsed.version !== PROJECT_REGISTRY_VERSION) throw new UnknownProjectRegistryVersionError(parsed.version)
  if (parsed.projects === undefined) throw new InvalidProjectRegistryError("registry.projects is required")
  if (!Array.isArray(parsed.projects)) throw new InvalidProjectRegistryError("registry.projects must be an array")
  const active = parsed.activeProjectId
  return {
    version: PROJECT_REGISTRY_VERSION,
    projects: parsed.projects.map(parseProject),
    activeProjectId: active === undefined ? undefined : parseOptionalString(active, "registry.activeProjectId"),
  }
}

export function serializeProjectRegistry(registry: ProjectRegistry): string {
  const out: Record<string, unknown> = {
    version: registry.version,
    projects: registry.projects.map(serializeProject),
  }
  if (registry.activeProjectId !== undefined) out.activeProjectId = registry.activeProjectId
  return JSON.stringify(out)
}
