import type { ExecFileOptionsWithStringEncoding } from "child_process"
import type { PRComment } from "../types"
import { oid, parse, PATCH_LIMIT, preview } from "../../shared/pr-comment-preview"

type Options = {
  repo: { owner: string; name: string }
  base: string
  head: string
  shell: (
    cmd: string,
    args: string[],
    options?: Omit<ExecFileOptionsWithStringEncoding, "encoding">,
  ) => Promise<{ stdout: string; stderr: string }>
  gh: (
    args: string[],
    options?: Omit<ExecFileOptionsWithStringEncoding, "encoding">,
  ) => Promise<{ stdout: string; stderr: string }>
}

type Patch = { base: string; patch?: string }
type Entry = { value: Patch; bytes: number; expires: number }
type File = { filename: string; previous_filename?: string; additions: number; deletions: number; patch?: string }

const MEMORY = 4 * 1024 * 1024
const OUTPUT = 1024 * 1024
const COMPARE = 2 * 1024 * 1024
const FILES = 32
const CACHE = 128
const DIFF = ["diff", "--no-ext-diff", "--no-textconv", "--no-color", "--find-renames", "-l1000", "--no-relative"]
const cache = new Map<string, Entry>()
let bytes = 0

export function clearContextCache(): void {
  cache.clear()
  bytes = 0
}

function cached(key: string) {
  const entry = cache.get(key)
  if (!entry) return undefined
  cache.delete(key)
  if (entry.expires <= Date.now()) {
    bytes -= entry.bytes
    return undefined
  }
  cache.set(key, entry)
  return entry.value
}

function remember(key: string, value: Patch) {
  const previous = cache.get(key)
  if (previous) bytes -= previous.bytes
  cache.delete(key)
  const size = Buffer.byteLength(key) + Buffer.byteLength(value.patch ?? "")
  while (cache.size >= CACHE || bytes + size > MEMORY) {
    const first = cache.entries().next().value
    if (!first) break
    bytes -= first[1].bytes
    cache.delete(first[0])
  }
  cache.set(key, { value, bytes: size, expires: value.patch ? Infinity : Date.now() + 30_000 })
  bytes += size
  return value
}

function path(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 4096 &&
    !/^(?:[/\\]|[a-z]:)/i.test(value) &&
    !value.includes("\0") &&
    !value.split("/").some((part) => part === ".." || part === ".")
  )
}

function names(text: string) {
  const values = text.split("\0")
  if (values.pop() !== "") throw new Error("Incomplete PR changed paths")
  const result = new Map<string, string[]>()
  const aliases = new Map<string, string[]>()
  for (let index = 0; index < values.length; ) {
    const status = values.at(index++) ?? ""
    if (!/^(?:[AMDT]|R\d+)$/.test(status)) throw new Error("Invalid PR changed path status")
    const before = values.at(index++)
    const after = status.startsWith("R") ? values.at(index++) : before
    if (!path(before) || !path(after)) throw new Error("Invalid PR changed path")
    const paths = before === after ? [after] : [before, after]
    result.set(after, paths)
    if (before !== after) aliases.set(before, paths)
  }
  for (const [file, paths] of aliases) {
    if (!result.has(file)) result.set(file, paths)
  }
  return result
}

async function compare(dir: string, opts: Options): Promise<{ base: string; files: File[] } | undefined> {
  const { stdout } = await opts.gh(
    [
      "api",
      `repos/${encodeURIComponent(opts.repo.owner)}/${encodeURIComponent(opts.repo.name)}/compare/${opts.base}...${opts.head}?per_page=1`,
      "--jq",
      "{base: .base_commit.sha, merge: .merge_base_commit.sha, files: [.files[] | {filename, previous_filename, additions, deletions, patch}]}",
    ],
    { cwd: dir, timeout: 10_000, maxBuffer: COMPARE },
  )
  if (Buffer.byteLength(stdout) > COMPARE) return undefined
  const data = JSON.parse(stdout) as { base?: string; merge?: string; files?: File[] }
  if (data.base !== opts.base || !oid(data.merge) || !Array.isArray(data.files) || data.files.length > 300)
    return undefined
  return { base: data.merge, files: data.files }
}

function remote(source: Awaited<ReturnType<typeof compare>>, file: string): Patch | undefined {
  if (!source) return undefined
  const matches = source.files.filter((item) => item.filename === file)
  const aliases = matches.length ? matches : source.files.filter((item) => item.previous_filename === file)
  const item = aliases.length === 1 ? aliases.at(0) : undefined
  if (!item || typeof item.patch !== "string") return undefined
  if (!Number.isSafeInteger(item.additions) || !Number.isSafeInteger(item.deletions)) return undefined
  if (item.additions < 0 || item.deletions < 0 || !parse(item.patch, item)) return undefined
  return { base: source.base, patch: item.patch }
}

function loader(dir: string, opts: Options) {
  const prefix = JSON.stringify([dir, opts.repo.owner, opts.repo.name, opts.base, opts.head])
  const deadline = Date.now() + 15_000
  const run = async (args: string[]) => {
    if (Date.now() >= deadline) throw new Error("PR preview deadline exceeded")
    const { stdout } = await opts.shell("git", ["--no-optional-locks", "--no-replace-objects", ...args], {
      cwd: dir,
      timeout: Math.max(1, Math.min(5_000, deadline - Date.now())),
      maxBuffer: PATCH_LIMIT,
      env: { ...process.env, GIT_NO_LAZY_FETCH: "1" },
    })
    if (Buffer.byteLength(stdout) > PATCH_LIMIT) throw new Error("PR preview maxBuffer exceeded")
    return stdout
  }
  const locate = async () => {
    const base = (await run(["merge-base", "--all", opts.base, opts.head])).trim()
    if (!oid(base)) return undefined
    const files = names(await run([...DIFF, "--name-status", "-z", base, opts.head, "--"]))
    return { base, files }
  }
  let local: ReturnType<typeof locate> | undefined
  let github: ReturnType<typeof compare> | undefined
  return async (file: string): Promise<Patch | undefined> => {
    const key = `${prefix}\0${file}`
    const hit = cached(key)
    if (hit) return hit
    if (Date.now() >= deadline) return undefined
    local ??= locate().catch(() => undefined)
    const source = await local
    const paths = source?.files.get(file)
    if (source && !paths) return remember(key, { base: source.base })
    if (source && paths) {
      const alias = paths.map((name) => cached(`${prefix}\0${name}`)).find((entry) => entry !== undefined)
      if (alias) return remember(key, alias)
      const result = await run([
        ...DIFF,
        "--unified=6",
        "--inter-hunk-context=0",
        source.base,
        opts.head,
        "--",
        ...paths.map((name) => `:(top,literal)${name}`),
      ]).then(
        (patch) => ({ patch }),
        (error: unknown) => ({ error }),
      )
      if ("patch" in result) {
        const value = { base: source.base, ...(parse(result.patch) ? { patch: result.patch } : {}) }
        for (const name of paths) remember(`${prefix}\0${name}`, value)
        return value
      }
      if (/maxBuffer/i.test(String(result.error))) return remember(key, { base: source.base })
    }
    if (Date.now() >= deadline) return undefined
    github ??= compare(dir, opts).catch(() => undefined)
    return remember(key, remote(await github, file) ?? { base: opts.base })
  }
}

function eligible(
  item: PRComment,
): item is PRComment & { file: string; side: "additions" | "deletions"; line: number } {
  return (
    !item.outdated &&
    !item.unmapped &&
    path(item.file) &&
    (item.side === "additions" || item.side === "deletions") &&
    Number.isSafeInteger(item.line) &&
    (item.line ?? 0) > 0
  )
}

export async function withContext(dir: string, comments: PRComment[], opts: Options): Promise<PRComment[]> {
  const result: PRComment[] = comments.map((item) => ({
    ...item,
    after: undefined,
    preview: undefined,
    previewUnavailable: true,
  }))
  if (!oid(opts.base) || !oid(opts.head)) return result
  const groups = new Map<string, number[]>()
  for (const [index, item] of comments.entries()) {
    if (!eligible(item)) continue
    const group = groups.get(item.file)
    if (group) group.push(index)
    if (!group && groups.size < FILES) groups.set(item.file, [index])
  }
  const load = loader(dir, opts)
  let remaining = OUTPUT
  for (const [file, indexes] of groups) {
    if (remaining <= 0) break
    const source = await load(file).catch(() => undefined)
    const patch = source?.patch ? parse(source.patch) : undefined
    if (!patch || !source) continue
    for (const index of indexes) {
      const item = result.at(index)!
      const view = preview(patch, item.line!, item.side!)
      if (!view) continue
      const size = Buffer.byteLength(view.patch)
      if (size > remaining) continue
      remaining -= size
      result[index] = {
        ...item,
        preview: { ...view, base: source.base, head: opts.head },
        previewUnavailable: undefined,
      }
    }
  }
  return result
}
