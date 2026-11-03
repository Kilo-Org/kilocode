import type { Plugin } from "esbuild"
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import path from "node:path"

// Solid's JSX compiler is the dominant cost of the webview build, and its output only depends on the file content and
// the transform toolchain. Cache the result by content in the OS temp dir so every worktree of this repo shares one
// cache and an unchanged file costs one read instead of a Babel parse.
const cacheDir = path.join(tmpdir(), `kilo-vscode-solid-${process.getuid?.() ?? "user"}`)
const memory = new Map<string, string>()
let babel: Promise<typeof import("@babel/core")> | undefined

// The cache key must change whenever the transform output can change: this module holds the options, and the presets
// hold the compiler. Hash both so an upgrade or an option edit invalidates every entry.
const toolchain = toolchainHash()
const disk = prepare()

export const solid: Plugin = {
  name: "solid",
  setup(build) {
    build.onLoad({ filter: /\.(t|j)sx$/ }, async (args) => {
      const source = readFileSync(args.path, "utf8")
      const { name, ext } = path.parse(args.path)
      const key = hash(name + ext, source, toolchain)
      const cached = memory.get(key)
      if (cached !== undefined) return { contents: cached, loader: "js" }

      const diskPath = path.join(cacheDir, `${key}.js`)
      if (disk) {
        try {
          const code = readFileSync(diskPath, "utf8")
          memory.set(key, code)
          return { contents: code, loader: "js" }
        } catch {}
      }

      babel ??= import("@babel/core")
      const { transformSync } = await babel
      const result = transformSync(source, {
        filename: args.path,
        babelrc: false,
        configFile: false,
        presets: [["babel-preset-solid", { generate: "dom" }], "@babel/preset-typescript"],
      })
      if (result?.code == null) throw new Error(`Could not compile ${args.path}`)

      memory.set(key, result.code)
      if (disk) write(diskPath, result.code)
      return { contents: result.code, loader: "js" }
    })
  },
}

function write(diskPath: string, code: string) {
  // Write through a temp file so a concurrent build in another worktree never reads a partial entry.
  const temp = `${diskPath}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(temp, code)
    renameSync(temp, diskPath)
  } catch (error) {
    rmSync(temp, { force: true })
    console.warn("[build] could not write the solid cache", diskPath, error)
  }
}

function hash(...parts: string[]) {
  const hasher = new Bun.CryptoHasher("sha256")
  for (const part of parts) hasher.update(part).update("\0")
  return hasher.digest("hex")
}

function toolchainHash() {
  const hasher = new Bun.CryptoHasher("sha256")
  hasher.update(readFileSync(import.meta.path, "utf8"))
  for (const name of ["@babel/core", "babel-preset-solid", "@babel/preset-typescript"]) {
    hasher.update(packageVersion(name, import.meta.dir))
  }
  hasher.update(packageVersion("babel-plugin-jsx-dom-expressions", packageDir("babel-preset-solid")))
  return hasher.digest("hex")
}

function packageDir(name: string) {
  return path.dirname(Bun.resolveSync(`${name}/package.json`, import.meta.dir))
}

function packageVersion(name: string, from: string) {
  const file = Bun.resolveSync(`${name}/package.json`, from)
  return file + JSON.parse(readFileSync(file, "utf8")).version
}

// The temp dir is world writable on Linux, so only trust a directory this user owns, created without following a link,
// and reachable without escaping the temp dir.
function prepare() {
  try {
    mkdirSync(cacheDir, { recursive: true, mode: 0o700 })
    const stat = lstatSync(cacheDir)
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("cache path is not a directory")
    const uid = process.getuid?.()
    if (uid !== undefined && stat.uid !== uid) throw new Error("cache directory is owned by another user")
    if (realpathSync(cacheDir) !== path.join(realpathSync(tmpdir()), path.basename(cacheDir))) {
      throw new Error("cache path escapes the temp directory")
    }
    if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) chmodSync(cacheDir, 0o700)
    sweep()
    return true
  } catch (error) {
    console.warn("[build] solid transform cache disabled", error)
    return false
  }
}

// Entries are content addressed and recomputed on a miss, so removing them is always safe. Sweep at most once a day
// because the directory is shared by every worktree.
function sweep() {
  const stamp = path.join(cacheDir, ".sweep")
  try {
    if (Date.now() - statSync(stamp).mtimeMs < 24 * 60 * 60 * 1000) return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("[build] could not read the solid cache sweep stamp", error)
    }
  }
  const age: Record<string, number> = { ".tmp": 60 * 60 * 1000, ".js": 30 * 24 * 60 * 60 * 1000 }
  for (const file of readdirSync(cacheDir)) {
    const limit = age[path.extname(file)]
    if (limit === undefined) continue
    const full = path.join(cacheDir, file)
    try {
      if (Date.now() - statSync(full).mtimeMs > limit) rmSync(full, { force: true })
    } catch (error) {
      console.warn("[build] could not reclaim a solid cache file", full, error)
    }
  }
  try {
    writeFileSync(stamp, "")
  } catch (error) {
    console.warn("[build] could not write the solid cache sweep stamp", error)
  }
}
