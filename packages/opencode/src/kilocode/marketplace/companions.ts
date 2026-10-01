import { randomUUID } from "crypto"
import * as fs from "fs/promises"
import path from "path"
import { Effect, Schema } from "effect"
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser"
import { Global } from "@opencode-ai/core/global"
import { Flock } from "@opencode-ai/core/util/flock"
import { ConfigMCPV1 } from "@opencode-ai/core/v1/config/mcp"
import { isRecord } from "@/util/record"
import { Filesystem } from "@/util/filesystem"
import * as Paths from "./paths"
import { OWNER, stageSkill } from "./skill-archive"
import type { McpSkill, Scope } from "./schema"

type Input = { scope: Scope; directory: string; worktree?: string }

const Receipt = Schema.Struct({
  version: Schema.Literal(1),
  id: Schema.String,
  token: Schema.String,
  config: Schema.String,
  base: Schema.String,
  skills: Schema.Array(Schema.String),
})
type Receipt = typeof Receipt.Type

const CONFIG_FILE = /^(kilo|opencode)\.jsonc?$|^config\.json$/

function safe(id: string) {
  return Paths.isSafeId(id) && !id.startsWith(".") && !["__proto__", "constructor", "prototype"].includes(id)
}

function unique(ids: readonly string[]) {
  return new Set(ids.map((id) => id.toLowerCase())).size === ids.length
}

function root(input: Input, skills = false) {
  if (input.scope === "project") return input.directory
  return skills ? Global.Path.home : Global.Path.config
}

function scratch(input: Input, token: string) {
  return path.join(path.dirname(Paths.skillsDir(input.scope, input.directory)), "marketplace", "staging", token)
}

async function stat(file: string) {
  return fs.lstat(file).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return undefined
    throw err
  })
}

// The supplied root is the selected scope, not an archive-controlled path. Do
// not follow symlinks in its config, receipt, staging, or skills descendants.
async function inspect(root: string, file: string) {
  const relative = path.relative(path.resolve(root), path.resolve(file))
  if (path.isAbsolute(relative) || relative.split(path.sep).at(0) === "..") {
    throw new Error(`Marketplace path is outside its scope: ${file}`)
  }
  let current = path.resolve(root)
  const parts = relative ? relative.split(path.sep) : []
  for (const part of ["", ...parts]) {
    current = path.join(current, part)
    const info = await stat(current)
    if (!info) return undefined
    if (info.isSymbolicLink()) throw new Error(`Marketplace path must not be a symlink: ${current}`)
    if (current === path.resolve(file)) return info
    if (!info.isDirectory()) throw new Error(`Marketplace path is not a directory: ${current}`)
  }
  return undefined
}

async function directory(root: string, dir: string) {
  const info = await inspect(root, dir)
  if (info && !info.isDirectory()) throw new Error(`Marketplace path is not a directory: ${dir}`)
  await fs.mkdir(dir, { recursive: true })
  await inspect(root, dir)
}

async function flush(dir: string) {
  // Windows does not support opening directories for fsync.
  if (process.platform === "win32") return
  const handle = await fs.open(dir, "r")
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function atomic(file: string, text: string, exclusive = false, mode = 0o600) {
  const temp = path.join(path.dirname(file), `.mcp-${randomUUID()}.tmp`)
  try {
    const handle = await fs.open(temp, "wx", mode)
    try {
      await handle.writeFile(text)
      await handle.sync()
    } finally {
      await handle.close()
    }
    // A receipt is an exclusive claim. A config rename is the final commit;
    // nothing after that rename may turn a complete install into a rollback.
    if (exclusive) await fs.link(temp, file)
    if (!exclusive) await fs.rename(temp, file)
  } finally {
    await fs.rm(temp, { force: true }).catch((err) => console.warn("Failed to clean marketplace temp file", err))
  }
}

export async function read(scope: Scope, directory: string, id: string, worktree?: string) {
  if (!safe(id)) return undefined
  const input = { scope, directory, worktree }
  const file = path.join(await Paths.mcpsDir(scope, directory, worktree), `${id}.json`)
  const info = await inspect(boundary(input), file)
  if (!info) return undefined
  if (!info.isFile()) throw new Error(`Invalid MCP ownership receipt: ${file}`)
  const receipt = Schema.decodeUnknownSync(Receipt)(JSON.parse(await fs.readFile(file, "utf8")))
  if (
    receipt.id !== id ||
    !/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(receipt.token) ||
    !receipt.skills.length ||
    !receipt.skills.every(safe) ||
    !unique(receipt.skills) ||
    !path.isAbsolute(receipt.config) ||
    !path.isAbsolute(receipt.base) ||
    !CONFIG_FILE.test(path.basename(receipt.config)) ||
    path.basename(receipt.base) !== "skills"
  ) {
    throw new Error(`Invalid MCP ownership receipt: ${file}`)
  }
  return receipt
}

async function owns(root: string, dir: string, receipt: Receipt) {
  await inspect(root, path.dirname(dir))
  const info = await stat(dir)
  if (!info?.isDirectory() || info.isSymbolicLink()) return false
  const marker = path.join(dir, OWNER)
  if (!(await stat(marker))?.isFile()) return false
  const text = await fs.readFile(marker, "utf8")
  const data: unknown = (() => {
    try {
      return JSON.parse(text)
    } catch {
      // An invalid or replaced marker is not proof of ownership.
      return undefined
    }
  })()
  return isRecord(data) && data.version === 1 && data.id === receipt.id && data.token === receipt.token
}

function marker(receipt: Receipt) {
  return JSON.stringify({ version: 1, id: receipt.id, token: receipt.token })
}

async function container(input: Input, receipt: Receipt) {
  const dir = scratch(input, receipt.token)
  await directory(root(input, true), path.dirname(dir))
  if (await stat(dir)) {
    if (!(await owns(root(input, true), dir, receipt))) throw new Error(`Unowned marketplace staging path: ${dir}`)
    return dir
  }
  await fs.mkdir(dir)
  await atomic(path.join(dir, OWNER), marker(receipt), true)
  await flush(dir)
  return dir
}

async function cleanup(input: Input, receipt: Receipt) {
  const base = receipt.base
  const held = await container(input, receipt)
  for (const id of receipt.skills) {
    const dir = path.join(base, id)
    const trash = path.join(held, id)
    if (await owns(root(input, true), dir, receipt)) {
      // Keep the container's ownership marker outside the tree being deleted.
      // A failed recursive removal can then retry even if it removed the skill's
      // own marker before failing. A replacement at the original path is safe.
      await fs.rm(trash, { recursive: true, force: true })
      await fs.rename(dir, trash)
    }
    await fs.rm(trash, { recursive: true, force: true })
  }
  const current = await read(input.scope, input.directory, receipt.id, input.worktree)
  if (current && current.token !== receipt.token) throw new Error("MCP ownership changed during removal")
  if (current)
    await fs.rm(path.join(await Paths.mcpsDir(input.scope, input.directory, input.worktree), `${receipt.id}.json`))
  // Only private staging metadata remains. A failure here must not mask a
  // completed removal or require adopting a skill on the next install.
  await fs
    .rm(held, { recursive: true, force: true })
    .catch((err) => console.warn("Failed to clean marketplace staging directory", err))
}

function boundary(input: Input) {
  if (input.scope === "global") return Global.Path.config
  const dir = Filesystem.resolve(input.directory)
  const worktree = input.worktree ? Filesystem.resolve(input.worktree) : dir
  const relative = path.relative(worktree, dir)
  if (worktree === path.parse(worktree).root || path.isAbsolute(relative) || relative.split(path.sep).at(0) === "..") {
    return dir
  }
  return worktree
}

async function config(input: Input, file: string) {
  const info = await inspect(boundary(input), file)
  if (info && !info.isFile()) throw new Error(`MCP config is not a regular file: ${file}`)
  const text = info ? await fs.readFile(file, "utf8") : "{}"
  const errors: ParseError[] = []
  const data: unknown = parse(text, errors, { allowTrailingComma: true })
  if (errors.length || !isRecord(data) || (data.mcp != null && !isRecord(data.mcp))) {
    throw new Error(`Invalid MCP config: ${file}; file left unchanged`)
  }
  return { text, data, mode: info ? info.mode & 0o777 : 0o600 }
}

async function patch(input: Input, file: string, id: string, entry?: Record<string, unknown>) {
  const before = await config(input, file)
  const present = isRecord(before.data.mcp) && Object.hasOwn(before.data.mcp, id) && before.data.mcp[id] != null
  if (entry && present) throw new Error("MCP server already installed. Remove it first.")
  if (!entry && !present) return
  const text = applyEdits(
    before.text,
    modify(before.text, ["mcp", id], entry, { formattingOptions: { insertSpaces: true, tabSize: 2 } }),
  )
  await directory(boundary(input), path.dirname(file))
  await atomic(file, text, false, before.mode)
}

function locked<T>(input: Input, run: () => Promise<T>) {
  if (input.scope !== "global") return run()
  // Share Config.updateGlobal's lock as well as the outer marketplace lock.
  return Flock.withLock(`config:global:${path.resolve(Global.Path.config)}`, run)
}

async function prepare(input: Input, id: string, skills: readonly McpSkill[], entry: Record<string, unknown>) {
  if (!safe(id)) throw new Error("Invalid MCP id for companion skills")
  if (!skills.length || !skills.every((skill) => safe(skill.id)) || !unique(skills.map((skill) => skill.id))) {
    throw new Error("Companion skill ids must be safe and unique")
  }
  Schema.decodeUnknownSync(ConfigMCPV1.Info)(entry)
  const file = await Paths.configPath(input.scope, input.directory, input.worktree)
  const before = await config(input, file)
  if (isRecord(before.data.mcp) && before.data.mcp[id] != null) {
    throw new Error("MCP server already installed. Remove it first.")
  }
  if (await read(input.scope, input.directory, id, input.worktree)) {
    throw new Error("MCP companion ownership already exists. Remove it before installing again.")
  }
  const base = Paths.skillsDir(input.scope, input.directory)
  await inspect(root(input, true), base)
  for (const skill of skills) {
    if (await stat(path.join(base, skill.id)))
      throw new Error(`Companion skill ${skill.id} already exists; left unchanged`)
  }
  const receipt: Receipt = {
    version: 1,
    id,
    token: randomUUID(),
    config: file,
    base,
    skills: skills.map((skill) => skill.id),
  }
  const held = await container(input, receipt)
  let recorded = false
  let committed = false
  try {
    for (const skill of skills) {
      const dir = path.join(held, skill.id)
      await fs.mkdir(dir)
      await stageSkill(skill, dir, true)
      await atomic(path.join(dir, OWNER), marker(receipt), true)
      await flush(dir)
    }
  } catch (err) {
    await fs
      .rm(held, { recursive: true, force: true })
      .catch((cause) => console.warn("Failed to clean marketplace staging directory", cause))
    throw err
  }

  return {
    async commit() {
      return locked(input, async () => {
        const receipts = await Paths.mcpsDir(input.scope, input.directory, input.worktree)
        await directory(boundary(input), receipts)
        await atomic(path.join(receipts, `${id}.json`), JSON.stringify(receipt), true)
        recorded = true
        // Persist the ownership claim before any discoverable skill or MCP.
        await flush(receipts)
        await directory(root(input, true), base)
        for (const skill of skills) {
          const dir = path.join(base, skill.id)
          if (await stat(dir)) throw new Error(`Companion skill ${skill.id} already exists; left unchanged`)
          await fs.rename(path.join(held, skill.id), dir)
        }
        await flush(base)
        // Re-read under the lock. Unrelated config edits made during downloads
        // are retained, and an existing MCP is never overwritten.
        await patch(input, file, id, entry)
        committed = true
        return [file, ...skills.map((skill) => path.join(base, skill.id, "SKILL.md"))]
      })
    },
    async dispose() {
      if (!committed && recorded) {
        await cleanup(input, receipt).catch((err) => {
          throw new Error(`MCP installation cleanup incomplete. Retry removal of ${id}: ${String(err)}`, { cause: err })
        })
        return
      }
      await fs
        .rm(held, { recursive: true, force: true })
        .catch((err) => console.warn("Failed to clean marketplace staging directory", err))
    },
  }
}

export function install(input: Input, id: string, skills: readonly McpSkill[], entry: Record<string, unknown>) {
  return Effect.acquireUseRelease(
    // Wait for staging I/O to settle before releasing the scope lock. Pending
    // interruption runs dispose before commit; commit itself is indivisible.
    Effect.tryPromise({ try: () => prepare(input, id, skills, entry), catch: (err) => err }),
    (staged) => Effect.tryPromise({ try: () => staged.commit(), catch: (err) => err }).pipe(Effect.uninterruptible),
    (staged) => Effect.promise(() => staged.dispose()),
  )
}

export function remove(input: Input, receipt: Receipt) {
  return Effect.tryPromise({
    try: async () => {
      await locked(input, async () => {
        // Remove only the config file the bundle was installed into. Other config
        // layers may define the same MCP id independently and must be preserved.
        await patch(input, receipt.config, receipt.id)
      })
      await cleanup(input, receipt)
    },
    catch: (err) => err,
  }).pipe(Effect.uninterruptible)
}
