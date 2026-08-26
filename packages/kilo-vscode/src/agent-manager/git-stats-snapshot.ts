import { createHash } from "crypto"
import * as fs from "fs/promises"
import { binaryFile } from "../diff/shared/binary"
import { resolveInside } from "../diff/shared/path"
import type { GitOps } from "./GitOps"

const MAX_BYTES = 1_000_000

export interface DiffStats {
  files: number
  additions: number
  deletions: number
}

export interface StatusSnapshot {
  branch: string
  dirty: boolean
  head: string
  fingerprint: string
  untracked: string[]
}

export interface RefSnapshot {
  oids: Map<string, string>
  upstreams: Map<string, string>
  worktreePaths?: Map<string, string>
}

export interface GitStatsSource {
  status(dir: string): Promise<StatusSnapshot>
  refs(root: string): Promise<RefSnapshot>
  diff(dir: string, base: string, untracked: string[]): Promise<DiffStats>
}

interface PathState {
  file: string
  missing: boolean
}

function tail(record: string, fields: number): string | undefined {
  let offset = 0
  for (let i = 0; i < fields; i++) {
    const next = record.indexOf(" ", offset)
    if (next === -1) return undefined
    offset = next + 1
  }
  return record.slice(offset)
}

function parse(raw: Buffer, linked: boolean): RefSnapshot {
  const fields = raw.toString("utf8").split("\0")
  const oids = new Map<string, string>()
  const upstreams = new Map<string, string>()
  const paths = linked ? new Map<string, string>() : undefined
  const size = linked ? 4 : 3

  for (let i = 0; i + size - 1 < fields.length; i += size) {
    const ref = fields[i]?.replace(/^\n/, "")
    const oid = fields[i + 1]
    const upstream = fields[i + 2]
    const worktree = linked ? fields[i + 3] : undefined
    if (!ref || !oid) continue
    oids.set(ref, oid)
    if (upstream) upstreams.set(ref, upstream)
    if (worktree && ref.startsWith("refs/heads/")) paths?.set(worktree, ref.slice(11))
  }

  return { oids, upstreams, ...(paths ? { worktreePaths: paths } : {}) }
}

function records(raw: Buffer): { branch: string; head: string; paths: PathState[]; untracked: string[] } {
  const items = raw.toString("utf8").split("\0")
  const paths: PathState[] = []
  const untracked: string[] = []
  let branch = ""
  let head = ""

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (!item) continue
    if (item.startsWith("# branch.oid ")) {
      head = item.slice(13)
      continue
    }
    if (item.startsWith("# branch.head ")) {
      const value = item.slice(14)
      branch = value === "(detached)" ? "HEAD" : value
      continue
    }
    if (item.startsWith("? ")) {
      const file = item.slice(2)
      untracked.push(file)
      paths.push({ file, missing: false })
      continue
    }
    if (item.startsWith("1 ")) {
      const file = tail(item, 8)
      if (file) paths.push({ file, missing: item.slice(2, 4).includes("D") })
      continue
    }
    if (item.startsWith("2 ")) {
      const file = tail(item, 9)
      if (file) paths.push({ file, missing: false })
      i++
      continue
    }
    if (item.startsWith("u ")) {
      const file = tail(item, 10)
      if (file) paths.push({ file, missing: true })
    }
  }

  return { branch, head, paths, untracked }
}

async function fingerprint(dir: string, raw: Buffer, paths: PathState[]): Promise<string | undefined> {
  const hash = createHash("sha256").update(raw)
  const unique = new Map(paths.map((item) => [item.file, item]))
  const files = [...unique.values()].sort((a, b) => a.file.localeCompare(b.file))

  for (const item of files) {
    const full = resolveInside(dir, item.file)
    if (!full) return undefined
    const stat = await fs.lstat(full, { bigint: true }).catch(() => undefined)
    if (!stat) {
      if (!item.missing) return undefined
      hash.update(`\0${item.file}\0missing`)
      continue
    }
    hash.update(`\0${item.file}\0${stat.dev}:${stat.ino}:${stat.mode}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`)
  }
  return hash.digest("hex")
}

function numstat(raw: Buffer): DiffStats {
  const result = { files: 0, additions: 0, deletions: 0 }
  for (const item of raw.toString("utf8").split("\0")) {
    if (!item) continue
    const first = item.indexOf("\t")
    const second = item.indexOf("\t", first + 1)
    if (first === -1 || second === -1) continue
    result.files++
    const additions = item.slice(0, first)
    const deletions = item.slice(first + 1, second)
    if (additions !== "-") result.additions += parseInt(additions, 10) || 0
    if (deletions !== "-") result.deletions += parseInt(deletions, 10) || 0
  }
  return result
}

async function lines(file: string): Promise<number> {
  const stat = await fs.lstat(file).catch(() => undefined)
  if (!stat || stat.size === 0 || stat.size > MAX_BYTES) return 0
  if (await binaryFile(file)) return 0
  const content = stat.isSymbolicLink()
    ? await fs.readlink(file).catch(() => "")
    : await fs.readFile(file, "utf8").catch(() => "")
  if (!content) return 0
  return content.endsWith("\n") ? content.split("\n").length - 1 : content.split("\n").length
}

export function refOID(refs: RefSnapshot | undefined, ref: string): string | undefined {
  if (!refs) return undefined
  if (ref.startsWith("refs/")) return refs.oids.get(ref)
  return refs.oids.get(`refs/remotes/${ref}`) ?? refs.oids.get(`refs/heads/${ref}`) ?? refs.oids.get(ref)
}

export function shortRef(ref: string): string {
  if (ref.startsWith("refs/remotes/")) return ref.slice(13)
  if (ref.startsWith("refs/heads/")) return ref.slice(11)
  return ref
}

export class GitStatsSnapshot implements GitStatsSource {
  private supported: boolean | undefined

  constructor(private readonly git: GitOps) {}

  async status(dir: string): Promise<StatusSnapshot> {
    const result = await this.git.execGitBuffer(
      [
        "--no-optional-locks",
        "status",
        "--porcelain=v2",
        "--branch",
        "-z",
        "--no-ahead-behind",
        "--untracked-files=all",
        "--no-renames",
      ],
      dir,
    )
    if (result.code !== 0) throw new Error(result.stderr.trim() || "git status failed")
    const parsed = records(result.stdout)
    if (!parsed.head || !parsed.branch) throw new Error("git status returned incomplete branch data")
    const stamp = await fingerprint(dir, result.stdout, parsed.paths)
    if (!stamp) throw new Error("worktree changed while status was being sampled")
    return {
      branch: parsed.branch,
      dirty: parsed.paths.length > 0,
      head: parsed.head,
      fingerprint: stamp,
      untracked: parsed.untracked,
    }
  }

  async refs(root: string): Promise<RefSnapshot> {
    if (this.supported !== false) {
      const result = await this.git.execGitBuffer(
        [
          "for-each-ref",
          "--format=%(refname)%00%(objectname)%00%(upstream)%00%(worktreepath)%00",
          "refs/heads",
          "refs/remotes",
        ],
        root,
      )
      if (result.code === 0) {
        this.supported = true
        return parse(result.stdout, true)
      }
      const error = result.stderr.toLowerCase()
      if (error.includes("unknown field") || error.includes("unknown atom")) this.supported = false
    }

    const result = await this.git.execGitBuffer(
      ["for-each-ref", "--format=%(refname)%00%(objectname)%00%(upstream)%00", "refs/heads", "refs/remotes"],
      root,
    )
    if (result.code !== 0) throw new Error(result.stderr.trim() || "git for-each-ref failed")
    return parse(result.stdout, false)
  }

  async diff(dir: string, base: string, untracked: string[]): Promise<DiffStats> {
    const ancestor = await this.git.execGit(["merge-base", "HEAD", base], dir)
    if (ancestor.code !== 0) throw new Error(ancestor.stderr.trim() || "git merge-base failed")
    const result = await this.git.execGitBuffer(
      ["-c", "core.quotepath=false", "diff", "--numstat", "-z", "--no-renames", ancestor.stdout.trim()],
      dir,
    )
    if (result.code !== 0) throw new Error(result.stderr.trim() || "git diff failed")
    const stats = numstat(result.stdout)
    const counts = await Promise.all(
      untracked.map(async (file) => {
        const full = resolveInside(dir, file)
        return full ? lines(full) : 0
      }),
    )
    return {
      files: stats.files + untracked.length,
      additions: stats.additions + counts.reduce((sum, count) => sum + count, 0),
      deletions: stats.deletions,
    }
  }
}
