import fs from "fs/promises"
import { glob } from "glob"
import ignore, { type Ignore } from "ignore"
import path from "path"
import { FileIgnore } from "../../file/ignore"

const files = [".gitignore", ".kilocodeignore"] as const
const order = new Map(files.map((name, index) => [name, index]))

type Entry = {
  dir: string
  name: string
  txt: string | undefined
}

export interface IgnoreMatcher {
  ignores(filePath: string): boolean
  // Directory globs (relative to root) a native file watcher can safely prune.
  // Optional and best-effort: correctness stays in ignores(); this only trims
  // watch descriptors so large repos don't exhaust inotify (ENOSPC).
  watchIgnoreGlobs?(): readonly string[]
}

function notFound(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false
  }
  return "code" in err && err.code === "ENOENT"
}

function toPosix(value: string): string {
  return value.replaceAll("\\", "/")
}

function depth(dir: string): number {
  if (!dir) {
    return 0
  }
  return dir.split("/").length
}

function relative(root: string, filePath: string): string | undefined {
  const rel = toPosix(path.relative(root, filePath))
  if (!rel || rel === ".") {
    return
  }
  if (rel === ".." || rel.startsWith("../") || path.isAbsolute(rel)) {
    return
  }
  return rel
}

async function read(filePath: string): Promise<string | undefined> {
  return fs.readFile(filePath, "utf8").catch((err) => {
    if (notFound(err)) {
      return undefined
    }
    throw err
  })
}

function escape(dir: string): string {
  return dir
    .split("/")
    .map((part) => part.replace(/[\\[\]*?!#]/g, "\\$&"))
    .join("/")
}

function discovery(): string[] {
  const result = new Set(FileIgnore.PATTERNS)
  for (const pattern of FileIgnore.PATTERNS) {
    if (pattern.includes("/") || [...pattern].some((char) => "*!?[]{}()".includes(char))) {
      continue
    }
    result.add(`${pattern}/**`)
    result.add(`**/${pattern}/**`)
  }
  return [...result]
}

function rules(dir: string, txt: string): string[] {
  const result = []
  for (const line of txt.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith("#")) {
      continue
    }

    const negated = line.startsWith("!")
    const raw = negated ? line.slice(1) : line
    const anchored = raw.startsWith("/")
    const body = anchored ? raw.slice(1) : raw
    if (!body) {
      continue
    }

    const root = escape(dir)
    const match = body.endsWith("/") ? body.slice(0, -1) : body
    const scoped = anchored || match.includes("/") ? `${root}/${body}` : `${root}/**/${body}`
    result.push(negated ? `!${scoped}` : scoped)
  }
  return result
}

// Glob metacharacters we don't translate into watcher globs (parcel uses
// micromatch); such patterns fall back to ignores() rather than risk drift.
const GLOB_META = /[*?[\]{}()]/

type PruneCandidate = { segment: string; glob: string; scoped: boolean }

// Derive best-effort directory-prune globs for the native watcher from the same
// .gitignore/.kilocodeignore lines. Only non-negated, non-glob directory patterns
// are emitted, and any candidate a re-include (!) could reach is dropped: parcel's
// ignore cannot honor negation, so an over-prune would silently stop indexing a
// re-included file. Under-pruning only costs a few watch descriptors.
//
// parcel matches glob entries (those containing `*`) against paths relative to the
// subscribed root and resolves plain entries to absolute paths, so both the
// `**/name` / `dir/**/name` globs and the anchored plain forms prune correctly.
function pruneGlobs(entries: Entry[]): string[] {
  const negated: string[] = []
  const candidates: PruneCandidate[] = []

  for (const entry of entries) {
    // The ignore file's own directory is interpolated raw into the emitted globs.
    // If it contains glob metacharacters (e.g. a Next.js `[slug]` route), that glob
    // would prune the wrong tree — skip emitting for it (shouldIndex() still filters
    // those paths). Negations are still collected below for shadow-safety.
    const dirHasMeta = !!entry.dir && GLOB_META.test(entry.dir)
    for (const line of (entry.txt ?? "").split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) {
        continue
      }

      const isNegated = trimmed.startsWith("!")
      const raw = isNegated ? trimmed.slice(1) : trimmed
      const anchored = raw.startsWith("/")
      const withoutAnchor = anchored ? raw.slice(1) : raw
      const body = withoutAnchor.endsWith("/") ? withoutAnchor.slice(0, -1) : withoutAnchor
      if (!body) {
        continue
      }

      const scoped = entry.dir ? `${entry.dir}/${body}` : body
      if (isNegated) {
        negated.push(scoped)
        continue
      }
      if (GLOB_META.test(body) || dirHasMeta) {
        continue
      }

      if (anchored || body.includes("/")) {
        // Anchored/pathful: a specific subtree, matched relative to root.
        candidates.push({ segment: scoped, glob: scoped, scoped: true })
      } else {
        // Bare name: prune that directory at any depth under its ignore file.
        candidates.push({ segment: body, glob: entry.dir ? `${entry.dir}/**/${body}` : `**/${body}`, scoped: false })
      }
    }
  }

  const result = new Set<string>()
  for (const candidate of candidates) {
    if (!negated.some((neg) => shadowed(candidate, neg))) {
      result.add(candidate.glob)
    }
  }
  return [...result]
}

// True when pruning candidate's directory would hide a re-included (negated) path.
function shadowed(candidate: PruneCandidate, negated: string): boolean {
  if (candidate.scoped) {
    return negated === candidate.segment || negated.startsWith(`${candidate.segment}/`)
  }
  // Bare-name prunes match that segment at any depth, so any negation whose path
  // crosses a same-named directory could be re-including something beneath it.
  const seg = candidate.segment
  return negated === seg || negated.startsWith(`${seg}/`) || negated.endsWith(`/${seg}`) || negated.includes(`/${seg}/`)
}

class WorkspaceIgnore implements IgnoreMatcher {
  constructor(
    private readonly matcher: Ignore,
    private readonly watchGlobs: readonly string[] = [],
  ) {}

  ignores(filePath: string): boolean {
    const rel = toPosix(path.normalize(filePath))
    if (!rel || rel === "." || rel === ".." || rel.startsWith("../") || path.isAbsolute(rel)) {
      return false
    }

    return this.matcher.ignores(rel)
  }

  watchIgnoreGlobs(): readonly string[] {
    return this.watchGlobs
  }
}

export async function loadIgnore(root: string): Promise<IgnoreMatcher> {
  const paths = await glob("**/{.gitignore,.kilocodeignore}", {
    cwd: root,
    absolute: true,
    nodir: true,
    dot: true,
    ignore: discovery(),
    maxDepth: Infinity,
  })

  const entries = await Promise.all(
    paths.map(async (filePath) => {
      const rel = relative(root, filePath)
      if (!rel) {
        return
      }
      if (FileIgnore.match(rel)) {
        return
      }

      const dir = toPosix(path.dirname(rel))
      const name = path.basename(rel)
      if (!order.has(name as (typeof files)[number])) {
        return
      }

      const txt = await read(filePath)

      return {
        dir: dir === "." ? "" : dir,
        name,
        txt,
      }
    }),
  )

  const sorted = entries
    .filter((entry): entry is Entry => Boolean(entry))
    .sort((left, right) => {
      const level = depth(left.dir) - depth(right.dir)
      if (level !== 0) {
        return level
      }
      const dir = left.dir.localeCompare(right.dir)
      if (dir !== 0) {
        return dir
      }
      return order.get(left.name as (typeof files)[number])! - order.get(right.name as (typeof files)[number])!
    })

  const matcher = ignore()
  for (const entry of sorted) {
    if (!entry.dir) {
      if (entry.txt?.trim()) {
        matcher.add(entry.txt)
      }
      matcher.add(entry.name)
      continue
    }

    if (entry.txt?.trim()) {
      matcher.add(rules(entry.dir, entry.txt))
    }
    matcher.add(`${entry.dir}/${entry.name}`)
  }
  matcher.add([".gitignore", ".kilocodeignore", "**/.gitignore", "**/.kilocodeignore"])

  return new WorkspaceIgnore(matcher, pruneGlobs(sorted))
}
