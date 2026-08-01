import { createHash } from "node:crypto"
import { access, readFile, readdir } from "node:fs/promises"
import { basename, dirname, join, relative, resolve } from "node:path"

export const STAMP = "world-daemon.source"
export const LOCK = ".world-daemon.lock"
export const ENTRY = "world-daemon.cjs"
export const MANIFEST = "world-daemon.assets.json"
export const LOCK_TIMEOUT_MS = 90_000
export const BUILD_TIMEOUT_MS = LOCK_TIMEOUT_MS + 60_000

export async function fingerprint(root: string): Promise<string> {
  const base = resolve(root)
  const files = [join(base, "package.json"), join(base, "script", "build-daemon.ts"), join(base, "script", "daemon.ts")]
  const walk = async (dir: string): Promise<string[]> => {
    const items = await readdir(dir, { withFileTypes: true })
    return (
      await Promise.all(
        items.map(async (item) => (item.isDirectory() ? walk(join(dir, item.name)) : [join(dir, item.name)])),
      )
    ).flat()
  }
  files.push(...(await walk(join(base, "src"))))
  const hash = createHash("sha256")
  for (const file of files.sort()) {
    hash.update(relative(base, file))
    hash.update("\0")
    hash.update(await readFile(file))
    hash.update("\0")
  }
  hash.update("playwright\0")
  hash.update(await dependency(base))
  return hash.digest("hex")
}

async function dependency(root: string): Promise<string> {
  const pkg: unknown = JSON.parse(await readFile(join(root, "package.json"), "utf8"))
  const spec = record(pkg) && record(pkg.dependencies) ? pkg.dependencies.playwright : undefined
  if (typeof spec !== "string") throw new Error("@kilocode/world must declare playwright as a dependency")
  for (const dir of parents(root)) {
    const text = await readFile(join(dir, "bun.lock"), "utf8").catch(() => undefined)
    if (!text) continue
    const start = text.indexOf('    "packages/kilo-world": {')
    const end = text.indexOf('\n    "packages/', start + 1)
    const workspace = start >= 0 ? text.slice(start, end >= 0 ? end : undefined) : ""
    if (!workspace.includes(`"playwright": ${JSON.stringify(spec)}`)) {
      throw new Error("bun.lock does not resolve @kilocode/world's playwright dependency")
    }
    const resolved = ["playwright", "playwright-core"].map((name) => {
      const prefix = `    ${JSON.stringify(name)}: [`
      const entry = text.split("\n").find((line) => line.startsWith(prefix))
      if (!entry) throw new Error(`bun.lock does not contain a resolved ${name} package`)
      return entry.trim()
    })
    const manifest: unknown = JSON.parse(await readFile(join(dir, "package.json"), "utf8"))
    const patched =
      record(manifest) && record(manifest.patchedDependencies)
        ? Object.entries(manifest.patchedDependencies).filter(([name]) => /^(playwright|playwright-core)@/.test(name))
        : []
    const patches = await Promise.all(
      patched.map(async ([name, file]) => {
        if (typeof file !== "string") throw new Error("bun.lock contains an invalid patch path")
        return [name, file, await readFile(join(dir, file), "utf8")]
      }),
    )
    return JSON.stringify({ spec, resolved, patches })
  }
  throw new Error("could not resolve playwright from bun.lock")
}

function parents(root: string): string[] {
  const dirs = [root]
  while (true) {
    const current = dirs.at(-1)!
    const parent = dirname(current)
    if (parent === current) break
    dirs.push(parent)
  }
  return dirs
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export async function fresh(dir: string, key: string, entry: string, manifest: string): Promise<boolean> {
  const saved = await readFile(join(dir, STAMP), "utf8")
    .then((value) => value.trim())
    .catch(() => "")
  if (saved !== key) return false
  const files: unknown = await readFile(join(dir, manifest), "utf8")
    .then((value): unknown => JSON.parse(value))
    .catch(() => [])
  if (!Array.isArray(files) || !files.every((item) => typeof item === "string" && basename(item) === item)) {
    return false
  }
  if (!files.includes(entry) || !files.includes(STAMP)) return false
  return (
    await Promise.all(
      files.map((file) =>
        access(join(dir, file)).then(
          () => true,
          () => false,
        ),
      ),
    )
  ).every(Boolean)
}
