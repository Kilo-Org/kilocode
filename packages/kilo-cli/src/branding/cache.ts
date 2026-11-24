import { randomUUID } from "node:crypto"
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"

// Content-addressed disk cache for source-mode Babel transforms (branding and Solid universal JSX).
// Entries live under this worktree's node_modules/.cache so separate worktrees never share cache state,
// and writes go through a temp file + rename so concurrent CLI and server processes never read partial output.

const repoRoot = path.resolve(import.meta.dir, "../../../..")

export function defaultCacheDir(name: string) {
  return path.resolve(import.meta.dir, "../../node_modules/.cache", name)
}

export function isInsideRepo(filePath: string) {
  const relative = path.relative(repoRoot, path.resolve(filePath))
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
}

export function prepareCacheDir(cacheDir: string) {
  try {
    mkdirSync(cacheDir, { recursive: true })
    return true
  } catch {
    return false
  }
}

export function hashParts(...parts: string[]) {
  const hasher = new Bun.CryptoHasher("sha256")
  for (const part of parts) hasher.update(part).update("\0")
  return hasher.digest("hex")
}

export function packageDir(name: string, from: string) {
  return path.dirname(Bun.resolveSync(`${name}/package.json`, from))
}

export function packageVersion(name: string, from: string) {
  try {
    const manifest = JSON.parse(readFileSync(Bun.resolveSync(`${name}/package.json`, from), "utf8")) as {
      version?: string
    }
    return manifest.version ?? ""
  } catch {
    return ""
  }
}

export function readCached(cacheDir: string, key: string, ext: string) {
  try {
    return readFileSync(path.join(cacheDir, `${key}.${ext}`), "utf8")
  } catch {
    return undefined
  }
}

export function writeCached(cacheDir: string, key: string, ext: string, contents: string) {
  const target = path.join(cacheDir, `${key}.${ext}`)
  const temp = `${target}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(temp, contents)
    renameSync(temp, target)
  } catch {
    rmSync(temp, { force: true })
  }
}
