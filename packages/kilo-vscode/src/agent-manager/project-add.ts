/**
 * Pure registration helper for ticket #12353 ("Add project flow + multi-project
 * accordion sidebar").
 *
 * Given a user-supplied folder URI/path, normalize it to a canonical Git
 * top-level, validate the filesystem scheme and authority, and emit either a
 * new `Project` entry or a structured `ProjectAddError`.
 *
 * The helper has three seams so tests can exercise each branch without a real
 * filesystem or git binary:
 *
 *  - `canonicalRoot` is the same `realpath + git rev-parse` helper the rest of
 *    the registry uses (canonical-root.ts).
 *  - `validateScheme` parses the supplied `input` into a `ParsedFolder` shape
 *    so tests can assert on the scheme/authority rejection paths without
 *    touching `vscode.Uri`.
 *  - `commit` is responsible for persisting the resulting registry; tests can
 *    substitute a recording stub.
 *
 * The helper is vscode-free: nothing here imports "vscode". The Agent Manager
 * provider passes a vscode-aware `commit` (the `ProjectRouting` save path)
 * and an optional folder picked through the host.
 */

import { canonicalRoot, NotAGitRepositoryError, CanonicalRootUnavailableError } from "./project-canonical-root"
import { projectIdFor } from "./project-id"
import { type Project, type ProjectRegistry, PROJECT_REGISTRY_VERSION } from "./project-registry"

export interface ParsedFolder {
  /** The raw scheme from the input (lowercased). */
  scheme: string
  /** The authority component if present (e.g. `host` of a `vscode-remote://` URI). */
  authority: string | null
  /** Filesystem path extracted from the URI or the original input when no URI. */
  path: string
}

/** Schemes Agent Manager refuses to register as a project. */
const UNSUPPORTED_SCHEMES = new Set([
  "vscode-vfs",
  "vscode-userdata",
  "vscode-settings",
  "output",
  "git",
  "comment",
  "vscode-test-web",
])

/**
 * Normalize a user-supplied folder identifier into the pieces we need to
 * validate. Accepts either a `vscode.Uri`-like object (anything with a `scheme`
 * and either `fsPath` or `path`) or a plain filesystem path string.
 */
export function parseFolderInput(input: unknown): ParsedFolder {
  if (typeof input === "string") {
    return parsePathString(input)
  }
  if (input && typeof input === "object") {
    const uriLike = input as { scheme?: unknown; authority?: unknown; fsPath?: unknown; path?: unknown }
    if (typeof uriLike.scheme !== "string") {
      throw new ProjectAddInvalidInputError("Folder URI must include a scheme")
    }
    const path = pickUriPath(uriLike)
    if (!path) {
      throw new ProjectAddInvalidInputError("Folder URI must include a fsPath or path")
    }
    return {
      scheme: uriLike.scheme.toLowerCase(),
      authority: typeof uriLike.authority === "string" ? uriLike.authority.toLowerCase() : null,
      path,
    }
  }
  throw new ProjectAddInvalidInputError("Folder must be a string or a URI object")
}

function parsePathString(raw: string): ParsedFolder {
  const trimmed = raw.trim()
  if (!trimmed) throw new ProjectAddInvalidInputError("Folder path must not be empty")
  // Treat Windows-style `C:\foo\bar` and `/foo/bar` as a plain file scheme.
  if (/^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.startsWith("/")) {
    return { scheme: "file", authority: null, path: trimmed }
  }
  if (trimmed.includes("://")) {
    const [scheme, rest] = trimmed.split("://", 2)
    if (!rest) throw new ProjectAddInvalidInputError(`Folder URI is missing a path: ${trimmed}`)
    const authority = rest.includes("/") ? rest.slice(0, rest.indexOf("/")) : rest
    const path = rest.includes("/") ? rest.slice(rest.indexOf("/")) : "/"
    return { scheme: scheme.toLowerCase(), authority: authority.toLowerCase(), path }
  }
  return { scheme: "file", authority: null, path: trimmed }
}

function pickUriPath(uri: { fsPath?: unknown; path?: unknown }): string | undefined {
  if (typeof uri.fsPath === "string" && uri.fsPath.length > 0) return uri.fsPath
  if (typeof uri.path === "string" && uri.path.length > 0) return uri.path
  return undefined
}

export interface ValidateSchemeResult {
  /** Folder input after scheme/authority validation. */
  folder: ParsedFolder
  /** Path that should be passed to the canonical-root helper. */
  candidate: string
}

export function validateScheme(folder: ParsedFolder): ValidateSchemeResult {
  if (UNSUPPORTED_SCHEMES.has(folder.scheme)) {
    throw new ProjectUnsupportedSchemeError(folder.scheme, folder.path)
  }
  // Only `file` and `vscode-remote` (ssh/dev-container/codespaces) are
  // resolvable today; `vscode-remote` is left as a follow-up to ship the file
  // scheme path first.
  if (folder.scheme !== "file") {
    throw new ProjectUnsupportedSchemeError(folder.scheme, folder.path)
  }
  if (!folder.path) {
    throw new ProjectAddInvalidInputError("Folder URI must include a path")
  }
  return { folder, candidate: folder.path }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type ProjectAddErrorCode =
  | "invalid_input"
  | "unsupported_scheme"
  | "not_a_git_repo"
  | "canonical_root_unavailable"
  | "duplicate_root"

export class ProjectAddError extends Error {
  override name = "ProjectAddError"
  constructor(
    public readonly code: ProjectAddErrorCode,
    message: string,
    public readonly detail?: Record<string, unknown>,
  ) {
    super(message)
  }
}

export class ProjectAddInvalidInputError extends ProjectAddError {
  override name = "ProjectAddInvalidInputError"
  constructor(message: string) {
    super("invalid_input", message)
  }
}

export class ProjectUnsupportedSchemeError extends ProjectAddError {
  override name = "ProjectUnsupportedSchemeError"
  constructor(
    public readonly scheme: string,
    public readonly attempted: string,
  ) {
    super(
      "unsupported_scheme",
      `Unsupported filesystem scheme "${scheme}"; only local file paths are supported for project registration.`,
      { scheme, attempted },
    )
  }
}

export class ProjectDuplicateRootError extends ProjectAddError {
  override name = "ProjectDuplicateRootError"
  constructor(
    public readonly root: string,
    public readonly existingProjectId: string,
  ) {
    super("duplicate_root", `Project already registered for ${root}`, { root, existingProjectId })
  }
}

// ---------------------------------------------------------------------------
// Core add helper
// ---------------------------------------------------------------------------

export interface AddProjectDeps {
  /** Resolve `input` to its canonical Git top-level. Defaults to `canonicalRoot`. */
  canonicalRoot?: typeof canonicalRoot
  /** Persist the resulting registry. Defaults to a no-op (tests stub this). */
  commit?: (registry: ProjectRegistry) => Promise<void> | void
  /** Snapshot of the live registry; the helper dedups against it. */
  registry: ProjectRegistry
  /** Wall-clock for `lastActiveAt`; injectable for deterministic tests. */
  now?: () => Date
  /** Default label; tests may override or pass undefined. */
  defaultLabel?: string
}

export interface AddProjectSuccess {
  ok: true
  project: Project
  /** True when the canonical root was already registered and the entry was untouched. */
  deduplicated: boolean
}

export type AddProjectResult = AddProjectSuccess | { ok: false; error: ProjectAddError }

export async function addProjectToRegistry(input: unknown, deps: AddProjectDeps): Promise<AddProjectResult> {
  let folder: ParsedFolder
  try {
    folder = parseFolderInput(input)
  } catch (err) {
    if (err instanceof ProjectAddError) return { ok: false, error: err }
    throw err
  }

  let validated: ValidateSchemeResult
  try {
    validated = validateScheme(folder)
  } catch (err) {
    if (err instanceof ProjectAddError) return { ok: false, error: err }
    throw err
  }

  const resolve = deps.canonicalRoot ?? canonicalRoot
  let canonical: string
  try {
    canonical = await resolve(validated.candidate)
  } catch (err) {
    if (err instanceof NotAGitRepositoryError) {
      return {
        ok: false,
        error: new ProjectAddError(
          "not_a_git_repo",
          `Selected folder is not inside a Git repository: ${validated.candidate}`,
          { candidate: validated.candidate },
        ),
      }
    }
    if (err instanceof CanonicalRootUnavailableError) {
      return {
        ok: false,
        error: new ProjectAddError(
          "canonical_root_unavailable",
          `Could not resolve a canonical Git root for ${validated.candidate}`,
          { candidate: validated.candidate, cause: err.cause },
        ),
      }
    }
    throw err
  }

  const id = projectIdFor(canonical)
  const existing = deps.registry.projects.find((p) => p.id === id || p.root === canonical)
  if (existing) {
    return {
      ok: true,
      project: existing,
      deduplicated: true,
    }
  }

  const now = (deps.now ?? (() => new Date()))().toISOString()
  const order = nextOrder(deps.registry)
  const label = deps.defaultLabel ?? deriveLabel(canonical)
  const project: Project = {
    id,
    root: canonical,
    order,
    collapsed: false,
    trusted: false,
    lastActiveAt: now,
    ...(label ? { label } : {}),
  }
  const next: ProjectRegistry = {
    version: PROJECT_REGISTRY_VERSION,
    projects: [...deps.registry.projects, project],
    activeProjectId: deps.registry.activeProjectId ?? id,
  }
  await deps.commit?.(next)
  return { ok: true, project, deduplicated: false }
}

function nextOrder(registry: ProjectRegistry): number {
  if (registry.projects.length === 0) return 0
  return Math.max(...registry.projects.map((p) => p.order)) + 1
}

function deriveLabel(canonicalRoot: string): string | undefined {
  const parts = canonicalRoot.split(/[\\/]/).filter(Boolean)
  const tail = parts[parts.length - 1]
  return tail && tail.length > 0 ? tail : undefined
}

// ---------------------------------------------------------------------------
// Pure registry mutation helpers (exported for tests and future remove flow)
// ---------------------------------------------------------------------------

export function removeProjectFromRegistry(registry: ProjectRegistry, id: string): ProjectRegistry {
  return {
    version: PROJECT_REGISTRY_VERSION,
    projects: registry.projects.filter((p) => p.id !== id),
    activeProjectId: registry.activeProjectId === id ? undefined : registry.activeProjectId,
  }
}

export function setProjectCollapsed(registry: ProjectRegistry, id: string, collapsed: boolean): ProjectRegistry {
  return {
    version: PROJECT_REGISTRY_VERSION,
    projects: registry.projects.map((p) => (p.id === id ? { ...p, collapsed } : p)),
    activeProjectId: registry.activeProjectId,
  }
}
