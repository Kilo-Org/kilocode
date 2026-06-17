import { AsyncLocalStorage } from "async_hooks"
import { chmod, lstat, mkdir, readFile, rename, rm, stat as follow, utimes, writeFile } from "fs/promises"
import path from "path"

export namespace MemoryFs {
  const locks = new Map<string, Promise<void>>()
  export const DIR = 0o700
  export const FILE = 0o600
  const STALE = 30_000
  const local = new AsyncLocalStorage<Set<string>>()

  export function warn(message: string, data?: unknown) {
    if (process.env.KILO_MEMORY_DEBUG !== "1") return
    console.warn(`[memory.files] ${message}`, data)
  }

  export function miss(error: unknown) {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
  }

  export async function exists(file: string) {
    await parents(path.dirname(file))
    return Boolean(await guard(file))
  }

  function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  function code(error: unknown) {
    return typeof error === "object" && error !== null && "code" in error ? String(error.code) : ""
  }

  export function parse(error: unknown) {
    return error instanceof SyntaxError
  }

  export function brief(error: unknown) {
    return error instanceof Error ? error.message.replaceAll(/\s+/g, " ").slice(0, 160) : String(error).slice(0, 160)
  }

  function trusted(file: string) {
    if (process.platform !== "darwin") return false
    return file === "/var" || file === "/tmp" || file === "/etc"
  }

  export async function guard(file: string) {
    const info = await lstat(file).catch((error: unknown) => {
      if (miss(error)) return
      throw error
    })
    if (info?.isSymbolicLink()) {
      if (trusted(path.resolve(file))) return follow(file)
      throw new Error(`memory path rejects symlink: ${file}`)
    }
    return info
  }

  async function parents(file: string) {
    const root = path.parse(path.resolve(file)).root
    const parts = path.resolve(file).slice(root.length).split(path.sep).filter(Boolean)
    await parts.reduce(async (prev, part) => {
      const base = await prev
      const next = path.join(base, part)
      const info = await guard(next)
      if (info && !info.isDirectory()) throw new Error(`memory parent is not a directory: ${next}`)
      return next
    }, Promise.resolve(root))
  }

  export async function dir(file: string) {
    await parents(path.dirname(file))
    await guard(file)
    await mkdir(file, { recursive: true, mode: DIR })
    await chmod(file, DIR).catch((error: unknown) => {
      if (process.platform === "win32") return
      throw error
    })
    const info = await guard(file)
    if (!info?.isDirectory()) throw new Error(`memory path is not a directory: ${file}`)
  }

  export async function write(file: string, text: string) {
    await dir(path.dirname(file))
    const info = await guard(file)
    if (info && !info.isFile()) throw new Error(`memory path is not a file: ${file}`)
    const salt = Math.random().toString(36).slice(2)
    const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.${salt}.tmp`)
    await writeFile(tmp, text, { mode: FILE })
    await chmod(tmp, FILE).catch((error: unknown) => {
      if (process.platform === "win32") return
      throw error
    })
    await rename(tmp, file).catch(async (error: unknown) => {
      await rm(tmp, { force: true }).catch((err: unknown) => warn("failed to clean memory temp file", { err, tmp }))
      throw error
    })
    await chmod(file, FILE).catch((error: unknown) => {
      if (process.platform === "win32") return
      throw error
    })
  }

  export async function read(file: string) {
    await parents(path.dirname(file))
    const info = await guard(file)
    if (!info) return undefined
    if (!info.isFile()) throw new Error(`memory path is not a file: ${file}`)
    return readFile(file, "utf8")
  }

  export async function json(file: string) {
    const text = await read(file)
    return text === undefined ? undefined : JSON.parse(text)
  }

  export async function backup(file: string) {
    const text = await read(file).catch((error: unknown) => {
      if (miss(error)) return undefined
      throw error
    })
    if (text === undefined) return
    await write(`${file}.bad-${Date.now()}`, text)
    await rm(file, { force: true })
  }

  export async function ensure(file: string, text: string) {
    if (await exists(file)) {
      const info = await guard(file)
      if (!info?.isFile()) throw new Error(`memory path is not a file: ${file}`)
      return
    }
    await write(file, text)
  }

  export async function mtime(file: string) {
    await parents(path.dirname(file))
    const info = await guard(file)
    if (!info) return 0
    if (!info.isFile()) throw new Error(`memory path is not a file: ${file}`)
    return info.mtimeMs
  }

  export async function mtimeNs(file: string) {
    await parents(path.dirname(file))
    const info = await lstat(file, { bigint: true }).catch((error: unknown) => {
      if (miss(error)) return undefined
      throw error
    })
    if (!info) return 0n
    if (info.isSymbolicLink()) throw new Error(`memory path must not be a symlink: ${file}`)
    return info.mtimeNs
  }

  async function lock(root: string) {
    await dir(root)
    const file = path.join(root, ".lock")
    const acquire = async (left: number): Promise<() => Promise<void>> => {
      try {
        await mkdir(file, { mode: DIR })
        const token = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`
        const owner = path.join(file, "owner")
        await writeFile(owner, token, { mode: FILE }).catch(async (error: unknown) => {
          await rm(file, { recursive: true, force: true })
          throw error
        })
        const timer = setInterval(() => {
          const now = new Date()
          void utimes(file, now, now).catch((error: unknown) => warn("failed to refresh memory lock", { error, root }))
        }, Math.floor(STALE / 3))
        timer.unref()
        return async () => {
          clearInterval(timer)
          const active = await readFile(owner, "utf8").catch((error: unknown) => {
            if (miss(error)) return ""
            throw error
          })
          if (active !== token) return
          await rm(file, { recursive: true, force: true })
        }
      } catch (error) {
        if (code(error) !== "EEXIST") throw error
        const info = await guard(file)
        if (!info?.isDirectory()) throw new Error(`memory lock is not a directory: ${file}`)
        if (Date.now() - info.mtimeMs > STALE) {
          const stolen = `${file}.steal.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`
          const moved = await rename(file, stolen).then(
            () => true,
            async (err: unknown) => {
              if (code(err) === "ENOENT") return false
              if (code(err) === "EEXIST") {
                await sleep(50)
                return false
              }
              throw err
            },
          )
          if (moved) await rm(stolen, { recursive: true, force: true })
          return acquire(left)
        }
        if (left <= 0) throw new Error(`timed out waiting for memory lock: ${root}`)
        await sleep(50)
        return acquire(left - 1)
      }
    }
    return acquire(800)
  }

  function nested(root: string) {
    return local.getStore()?.has(root) === true
  }

  export async function queue<T>(root: string, fn: () => Promise<T>): Promise<T> {
    if (nested(root)) return fn()
    const prev = locks.get(root) ?? Promise.resolve()
    const next = prev
      .catch((err: unknown) => {
        warn("previous memory queue operation failed", { root, err })
      })
      .then(async () => {
        const release = await lock(root)
        try {
          const roots = new Set(local.getStore() ?? [])
          roots.add(root)
          return await local.run(roots, fn)
        } finally {
          await release()
        }
      })
    const done = next.then(
      () => undefined,
      () => undefined,
    )
    locks.set(root, done)
    try {
      return await next
    } finally {
      if (locks.get(root) === done) locks.delete(root)
    }
  }
}
