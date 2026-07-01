import { readFileSync, realpathSync, statSync } from "fs"
import { createHash } from "crypto"
import path from "path"
import type { MemorySchema } from "../schema"
import { MemorySlug } from "../slug"

export namespace MemoryPaths {
  export type Ctx = {
    directory: string
    worktree: string
  }

  export type Files = {
    root: string
    state: string
    index: string
    manifest: string
    project: string
    environment: string
    corrections: string
    sessions: string
    decisions: string
    ignore: string
  }

  export type Identity = {
    display: string
    canonical: string
    folder: string
  }

  export type Host = {
    home: string
    config: string
  }

  function base(ctx: Ctx) {
    return ctx.worktree === "/" ? ctx.directory : ctx.worktree
  }

  function stat(file: string) {
    return statSync(file, { throwIfNoEntry: false })
  }

  function read(file: string) {
    try {
      return readFileSync(file, "utf8").trim()
    } catch {
      return undefined
    }
  }

  function checkout(dir: string) {
    return path.basename(dir) === ".git" ? path.dirname(dir) : undefined
  }

  function common(dir: string) {
    const text = read(path.join(dir, "commondir"))
    return text ? path.resolve(dir, text) : dir
  }

  function project(dir: string) {
    const dot = path.join(dir, ".git")
    const info = stat(dot)
    if (!info) return dir
    if (info.isDirectory()) return checkout(common(dot)) ?? dir
    if (!info.isFile()) return dir
    const text = read(dot)
    const match = text?.match(/^gitdir:\s*(.+)$/m)
    if (!match?.[1]) return dir
    const git = path.resolve(dir, match[1])
    if (!belongs(dot, git)) return dir
    return checkout(common(git)) ?? dir
  }

  function belongs(dot: string, git: string) {
    const back = read(path.join(git, "gitdir"))
    if (!back) return false
    return canon(path.resolve(git, back)) === canon(dot)
  }

  function canon(dir: string) {
    const resolved = path.resolve(dir)
    try {
      return realpathSync(resolved)
    } catch {
      return resolved
    }
  }

  export function identity(input: { ctx: Ctx }): Identity {
    const root = canon(project(base(input.ctx)))
    const display = MemorySlug.safe(path.basename(root), { max: MemorySlug.max.label, fallback: "project" })
    const hash = createHash("sha1").update(root).digest("hex").slice(0, 12)
    return {
      display,
      canonical: root,
      folder: `${display}-${hash}`,
    }
  }

  function global(input: Host) {
    const dir = path.resolve(input.config)
    if (path.basename(dir) === ".kilo") return dir
    return path.join(input.home, ".kilo")
  }

  export function root(input: { ctx: Ctx } & Host) {
    return path.join(global(input), "memory", identity(input).folder)
  }

  export function files(root: string): Files {
    return {
      root,
      state: path.join(root, "state.json"),
      index: path.join(root, "index.kmem"),
      manifest: path.join(root, "manifest.json"),
      project: path.join(root, "project.md"),
      environment: path.join(root, "environment.md"),
      corrections: path.join(root, "corrections.md"),
      sessions: path.join(root, "sessions"),
      decisions: path.join(root, "decisions.jsonl"),
      ignore: path.join(root, ".gitignore"),
    }
  }

  export function source(root: string, name: MemorySchema.Source) {
    const paths = files(root)
    if (name === "project.md") return paths.project
    if (name === "environment.md") return paths.environment
    return paths.corrections
  }
}
