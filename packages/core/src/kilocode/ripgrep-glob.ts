// Glob matching that keeps ripgrep's ignore rules in charge (#15003).
//
// Passing the agent's pattern as `--glob=<pattern>` makes it a ripgrep override, and overrides win over
// `.gitignore`: a pattern that also matches folder names, such as `**/*`, walks `node_modules`, and
// gitignored files that match the pattern are returned. Instead, ripgrep lists the files its ignore rules
// allow and the pattern is applied here with the gitignore-style rules ripgrep uses for overrides.
//
// Hidden paths keep their previous behavior: a hidden file is returned when it matches the pattern, and a
// hidden folder is searched only when the pattern matches the folder itself, as ripgrep does for overrides.

export interface Input {
  readonly pattern: string
  readonly hidden?: boolean
  readonly include?: readonly string[]
}

export interface Walk {
  readonly args: readonly string[]
  readonly match: (file: string) => boolean
}

/** Match a cwd-relative path the way ripgrep matches an override glob. */
export function compile(pattern: string) {
  const dir = pattern.endsWith("/")
  const body = pattern.replace(/\/+$/, "")
  const text = body.includes("/") ? body.replace(/^\//, "") : `**/${body}`
  const glob = new Bun.Glob(text)
  // ripgrep treats a trailing `/**` as everything inside the folder, but not the folder itself.
  const folders = text.endsWith("/**") ? new Bun.Glob(`${text}/*`) : glob
  return (path: string, folder: boolean) => {
    if (folder) return folders.match(path)
    return !dir && glob.match(path)
  }
}

/**
 * A file-name pattern can also be applied by ripgrep as a file type. Types match after ignore rules, so they
 * keep ripgrep from printing every file; `match` still decides, which covers hidden folders and edge cases.
 */
function prefilter(pattern: string) {
  const name = pattern.replace(/^(\*\*\/)+/, "")
  if (!name || name.includes("/") || name.includes(":")) return []
  return [`--type-add=kiloglob:${name}`, "--type=kiloglob"]
}

/**
 * Ripgrep arguments and a path filter for a glob search, or undefined when ripgrep should apply the pattern
 * itself: negated patterns never override ignore rules, and allowlist searches rely on override globs.
 */
export function walk(input: Input): Walk | undefined {
  if (input.include?.length || input.pattern.startsWith("!")) return undefined
  const test = compile(input.pattern)
  const dirs = new Map<string, boolean>()
  const folder = (dir: string) => {
    const known = dirs.get(dir)
    if (known !== undefined) return known
    const hit = test(dir, true)
    dirs.set(dir, hit)
    return hit
  }
  return {
    // `--pre-glob` makes ripgrep validate the pattern without using it, since no `--pre` command is set.
    args: ["--hidden", `--pre-glob=${input.pattern}`, ...prefilter(input.pattern)],
    match: (file) => {
      if (!test(file, false)) return false
      if (input.hidden) return true
      const parts = file.split("/")
      return parts
        .slice(0, -1)
        .every((part, index) => !part.startsWith(".") || folder(parts.slice(0, index + 1).join("/")))
    },
  }
}

const cache = new WeakMap<object, Walk | undefined>()

const plan = (input: Input) => {
  if (cache.has(input)) return cache.get(input)
  const result = walk(input)
  cache.set(input, result)
  return result
}

/** Pattern arguments for `rg --files`. */
export const args = (input: Input) => plan(input)?.args ?? [`--glob=${input.pattern}`]

/** The cwd-relative path when the search keeps it, otherwise undefined. */
export const keep = (input: Input & { readonly filter?: (path: string) => boolean }, path: string) => {
  const result = plan(input)
  if (result && !result.match(path)) return undefined
  if (input.filter && !input.filter(path)) return undefined
  return path
}
