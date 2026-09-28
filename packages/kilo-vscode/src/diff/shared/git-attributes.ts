import type { GitOps } from "../../agent-manager/GitOps"

const ATTRIBUTE = "linguist-generated"
const FOLDERS = new Set([
  "node_modules",
  "bower_components",
  ".pnpm-store",
  "vendor",
  ".npm",
  "dist",
  "build",
  "out",
  ".next",
  "target",
  "bin",
  "obj",
  ".git",
  ".svn",
  ".hg",
  ".vscode",
  ".idea",
  ".turbo",
  ".output",
  "desktop",
  ".sst",
  ".cache",
  ".webkit-cache",
  "__pycache__",
  ".pytest_cache",
  "mypy_cache",
  ".history",
  ".gradle",
])

const SUFFIXES = [".swp", ".swo", ".pyc", ".log"]
const BASENAMES = new Set([".DS_Store", "Thumbs.db"])
const CONTAINS_SEGMENTS = ["logs", "tmp", "temp", "coverage", ".nyc_output"]

export type GeneratedAttributes = ReadonlyMap<string, boolean>
export type GeneratedFiles = (files: readonly string[]) => Promise<GeneratedAttributes>

export function generatedLike(file: string): boolean {
  const parts = file.split(/[/\\]/)
  for (const part of parts) {
    if (FOLDERS.has(part)) return true
    if (CONTAINS_SEGMENTS.includes(part)) return true
  }
  for (const suffix of SUFFIXES) {
    if (file.endsWith(suffix)) return true
  }
  const base = parts[parts.length - 1] ?? ""
  return BASENAMES.has(base)
}

export function classifyGenerated(file: string, attrs?: GeneratedAttributes): boolean {
  return attrs?.get(file) ?? generatedLike(file)
}

/**
 * Read the repository's generated-file attributes for a set of paths.
 * GitHub Linguist uses `linguist-generated`, and repositories already keep
 * those rules in `.gitattributes` for pull-request diffs.
 */
export async function gitGeneratedFiles(
  git: GitOps,
  dir: string,
  files: readonly string[],
  options: { cached?: boolean; signal?: AbortSignal } = {},
): Promise<Map<string, boolean>> {
  const paths = [...new Set(files.filter(Boolean))]
  if (paths.length === 0) return new Map()

  const args = ["check-attr"]
  if (options.cached) args.push("--cached")
  args.push("-z", "--stdin", ATTRIBUTE)
  const result = await git.execGit(args, dir, {
    stdin: `${paths.join("\0")}\0`,
    signal: options.signal,
    priority: true,
  })
  if (result.code !== 0) return new Map()

  const attrs = new Map<string, boolean>()
  const fields = result.stdout.split("\0")
  for (let field = 0; field + 2 < fields.length; field += 3) {
    if (fields[field + 1] !== ATTRIBUTE) continue
    const value = fields[field + 2]
    if (value === "true" || value === "set") attrs.set(fields[field]!, true)
    if (value === "false" || value === "unset") attrs.set(fields[field]!, false)
  }
  return attrs
}
