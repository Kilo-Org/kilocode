import fs from "node:fs/promises"
import path from "node:path"
import type { NotebookAccess } from "./types"

const WINDOWS_ABSOLUTE = /^[a-zA-Z]:[/\\]/

export interface NotebookErrorDetails {
  path?: string
  index?: number
  currentRevision?: string
}

export class NotebookError extends Error {
  readonly path?: string
  readonly index?: number
  readonly currentRevision?: string

  constructor(
    public readonly code: string,
    message: string,
    details: NotebookErrorDetails = {},
  ) {
    super(message)
    this.name = "NotebookError"
    this.path = details.path
    this.index = details.index
    this.currentRevision = details.currentRevision
  }
}

export interface NotebookPathDeps {
  realpath(path: string): Promise<string>
}

export interface NotebookPath {
  target: string
  relative: string
}

const defaults: NotebookPathDeps = { realpath: fs.realpath }

function contained(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
}

function invalid(input: string, reason: string): NotebookError {
  return new NotebookError(
    "invalid_path",
    `Invalid notebook path ${JSON.stringify(input)}: ${reason}. Use a path relative to the request directory or an absolute path inside it`,
    { path: input },
  )
}

export async function resolveNotebookPath(
  directory: string,
  input: string,
  access: NotebookAccess,
  deps: NotebookPathDeps = defaults,
): Promise<NotebookPath> {
  if (!input || input.length > 4_096 || input.includes("\0")) {
    throw invalid(input, "the path is empty, too long, or malformed")
  }
  if (WINDOWS_ABSOLUTE.test(input) && !path.win32.isAbsolute(directory)) {
    throw invalid(input, "the absolute path uses a different platform format")
  }

  const base = path.resolve(directory)
  const root = await deps.realpath(base)
  const candidate = path.resolve(base, input)
  if (!path.isAbsolute(input) && !contained(base, candidate)) {
    throw invalid(input, "it is outside the request directory")
  }

  const target = await deps.realpath(candidate).catch((error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error)
    throw new NotebookError("not_found", `Cannot resolve notebook ${JSON.stringify(input)}: ${detail}`, { path: input })
  })
  if (!contained(root, target)) {
    throw invalid(input, "it resolves through a symlink outside the request directory")
  }
  if (!(await access.validateAccess(target))) {
    throw invalid(input, "it is excluded by workspace access or ignore rules")
  }
  return { target, relative: path.relative(root, target).split(path.sep).join("/") }
}

// Resolve a path for a notebook that does not exist yet. The file itself is not
// realpathed (it must not exist); instead the parent directory is realpathed and
// must be contained in the request root and pass access checks.
export async function resolveNotebookCreatePath(
  directory: string,
  input: string,
  access: NotebookAccess,
  deps: NotebookPathDeps = defaults,
): Promise<NotebookPath> {
  if (!input || input.length > 4_096 || input.includes("\0")) {
    throw invalid(input, "the path is empty, too long, or malformed")
  }
  if (WINDOWS_ABSOLUTE.test(input) && !path.win32.isAbsolute(directory)) {
    throw invalid(input, "the absolute path uses a different platform format")
  }
  if (!input.toLowerCase().endsWith(".ipynb")) {
    throw invalid(input, "only .ipynb notebooks can be created")
  }

  const base = path.resolve(directory)
  const root = await deps.realpath(base)
  const candidate = path.resolve(base, input)
  if (!path.isAbsolute(input) && !contained(base, candidate)) {
    throw invalid(input, "it is outside the request directory")
  }

  const parent = await deps.realpath(path.dirname(candidate)).catch((error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error)
    throw new NotebookError("not_found", `Cannot resolve the parent directory of ${JSON.stringify(input)}: ${detail}`, {
      path: input,
    })
  })
  if (!contained(root, parent)) {
    throw invalid(input, "its parent directory resolves outside the request directory")
  }

  const target = path.join(parent, path.basename(candidate))
  const existing = await deps.realpath(target).then(
    () => true,
    () => false,
  )
  if (existing) {
    throw new NotebookError("already_exists", `Notebook ${JSON.stringify(input)} already exists`, { path: input })
  }
  if (!(await access.validateAccess(target))) {
    throw invalid(input, "it is excluded by workspace access or ignore rules")
  }
  return { target, relative: path.relative(root, target).split(path.sep).join("/") }
}
