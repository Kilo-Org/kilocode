/**
 * Dependency manifests, and which region of one a change touches.
 *
 * Pure text work, like the rest of the pure half of the layer: it reads the unified diff the edit
 * tools already attach to their permission request and never opens a file. The diff is the only
 * evidence available before the write happens, so anything it cannot show — a hunk whose block
 * header scrolled out of context, a whole-file rewrite — resolves to `other`, which still reaches a
 * human through the manifest rule rather than falling through to an ordinary edit.
 */
export namespace SecurityManifest {
  /** Files that declare, resolve or pin what the project pulls in from outside. */
  const NAMES = new Set([
    "bun.lock",
    "bun.lockb",
    "Cargo.lock",
    "Cargo.toml",
    "composer.json",
    "composer.lock",
    "deno.json",
    "deno.jsonc",
    "deno.lock",
    "Gemfile",
    "Gemfile.lock",
    "go.mod",
    "go.sum",
    "npm-shrinkwrap.json",
    "package-lock.json",
    "package.json",
    "Pipfile",
    "Pipfile.lock",
    "pnpm-lock.yaml",
    "poetry.lock",
    "pyproject.toml",
    "uv.lock",
    "yarn.lock",
  ])

  /** `requirements.txt`, `requirements-dev.txt`, `dev-requirements.txt`. */
  const REQUIREMENTS = /^(.*-)?requirements(-.+)?\.txt$/

  export function is(base: string) {
    return NAMES.has(base) || REQUIREMENTS.test(base)
  }

  export type Region = "scripts" | "dependencies" | "other"

  /** Blocks whose entries are commands the package manager runs around an install. */
  const SCRIPT_BLOCKS = new Set(["scripts"])

  /** Blocks whose entries are external packages. */
  const DEPENDENCY_BLOCKS = new Set([
    "bundledDependencies",
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "overrides",
    "peerDependencies",
    "resolutions",
  ])

  /** Lifecycle keys that name a command even when the enclosing block is out of the hunk. */
  const LIFECYCLE = new Set([
    "postinstall",
    "postpack",
    "preinstall",
    "prepack",
    "prepare",
    "prepublish",
    "prepublishOnly",
    "scripts",
  ])

  const OPENER = /^[-+ ]?\s*"([A-Za-z]+)"\s*:\s*\{/
  const KEY = /"([A-Za-z]+)"\s*:/

  /**
   * The region a diff changes. Only added and removed lines decide it; a block header seen in the
   * surrounding context sets which block those lines fall in, and a hunk boundary drops that context
   * because the next hunk may sit anywhere in the file.
   */
  export function region(diff: unknown): Region {
    if (typeof diff !== "string" || diff.length === 0) return "other"
    let block: string | undefined
    let seen: Region = "other"
    for (const line of diff.split("\n")) {
      if (line.startsWith("@@") || line.startsWith("---") || line.startsWith("+++")) {
        block = undefined
        continue
      }
      const opener = OPENER.exec(line)
      const changed = line.startsWith("+") || line.startsWith("-")
      if (opener) {
        block = opener[1]
        if (!changed) continue
      }
      if (!changed) continue
      const key = KEY.exec(line)?.[1]
      if ((block && SCRIPT_BLOCKS.has(block)) || (key && LIFECYCLE.has(key))) return "scripts"
      if ((block && DEPENDENCY_BLOCKS.has(block)) || (key && DEPENDENCY_BLOCKS.has(key))) seen = "dependencies"
    }
    return seen
  }
}
