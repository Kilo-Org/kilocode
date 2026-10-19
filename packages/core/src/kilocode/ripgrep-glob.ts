// Glob matching that keeps ripgrep's ignore rules in charge (#15003).
//
// Passing the agent's pattern as `--glob=<pattern>` makes it a ripgrep override, and overrides win over
// `.gitignore`: a pattern that also matches folder names, such as `**/*`, walks `node_modules`, and
// gitignored files that match the pattern are returned. Instead, ripgrep lists the files its ignore rules
// allow and the pattern is applied here with the gitignore-style rules ripgrep uses for overrides.
//
// Hidden paths keep their previous behavior: a hidden file is returned when it matches the pattern, and a
// hidden folder is searched only when the pattern matches the folder itself, as ripgrep does for overrides.
// The same applies to the grep `include` filter and to `find`, which pass globs to ripgrep the same way.

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
 * Ripgrep can also apply the last path segment of the pattern as a file type. Types match file names after
 * ignore rules, so they keep ripgrep from printing (or, for grep, reading) every file; `match` still
 * decides, which covers the folder part of the pattern, hidden folders, and edge cases. Patterns whose
 * braces span folders, such as `{src/*.ts,lib/*.js}`, have no single last segment and skip this.
 */
function prefilter(pattern: string) {
  const name = pattern.split("/").at(-1) ?? ""
  if (!name || name === "**" || name.includes(":") || pattern.includes("\\/")) return []
  if (/\{[^}]*\//.test(pattern) || name.split("{").length !== name.split("}").length) return []
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

export interface Plan {
  readonly args: readonly string[]
  readonly keep: (path: string) => boolean
}

const all: Plan = { args: [], keep: () => true }

/** Remember one plan per search input, since ripgrep arguments and every output line need the same one. */
const memo = <A extends object>(make: (input: A) => Plan) => {
  const cache = new WeakMap<A, Plan>()
  return (input: A) => {
    const known = cache.get(input)
    if (known) return known
    const plan = make(input)
    cache.set(input, plan)
    return plan
  }
}

const plan = (pattern: string, input: Omit<Input, "pattern">) => {
  const result = walk({ ...input, pattern })
  return { args: result?.args ?? [`--glob=${pattern}`], keep: result?.match ?? all.keep }
}

/** `rg --files` arguments and the per-path filter for a glob search. */
export const glob = memo((input: Input & { readonly filter?: (path: string) => boolean }): Plan => {
  const base = plan(input.pattern, input)
  const filter = input.filter
  if (!filter) return base
  return { args: base.args, keep: (path) => base.keep(path) && filter(path) }
})

/** `rg --files` arguments and the per-path filter for a find, where `*` lists every file. */
export const find = memo((input: Input): Plan => (input.pattern === "*" ? all : plan(input.pattern, input)))

/**
 * Arguments and the per-path filter for the grep `include` glob. Grep always searches hidden files. An
 * explicit file is searched whatever the glob says, as before.
 */
export const grep = memo((input: { readonly include?: string; readonly file?: string }): Plan => {
  if (!input.include) return all
  if (input.file) return { args: [`--glob=${input.include}`], keep: all.keep }
  return plan(input.include, { hidden: true })
})

/** Normalize a ripgrep output path to the cwd-relative, slash-separated form that plans match. */
export const relative = (line: string) =>
  line
    .replace(/^(?:\.[\\/])+/u, "")
    .replace(/^[\\/]+/u, "")
    .replaceAll("\\", "/")
