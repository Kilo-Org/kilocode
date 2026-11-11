import { transformSync } from "@babel/core"
import type { Plugin } from "esbuild"
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import path from "node:path"

// Solid's JSX compiler is the dominant cost of the webview build, and its output only depends on the file content and
// the transform toolchain. Cache it under this worktree's node_modules so an unchanged file costs one read instead of a
// Babel parse, without sharing state between worktrees. Babel is imported eagerly on purpose: a dynamic import inside
// the esbuild callback can stall the build when several webview tests compile at once.

// The cache key must change whenever the transform output can change: this module holds the options, and the presets
// hold the compiler. Versions only, because resolved package paths are install-layout detail.
const toolchain = toolchainHash()

export function createSolidPlugin(options: { root: string; cacheDir?: string }): Plugin {
  const cacheDir = options.cacheDir ?? path.join(options.root, "node_modules", ".cache", "kilo-vscode-solid")
  const memory = new Map<string, string>()
  const disk = prepare(cacheDir)

  return {
    name: "solid",
    setup(build) {
      build.onLoad({ filter: /\.(t|j)sx$/ }, (args) => {
        const source = readFileSync(args.path, "utf8")
        const file = path.relative(options.root, args.path).split(path.sep).join("/")
        const key = hash(file, source, toolchain)
        const cached = memory.get(key)
        if (cached !== undefined) return { contents: cached, loader: "js" }

        const diskPath = path.join(cacheDir, `${key}.js`)
        if (disk) {
          try {
            const code = readFileSync(diskPath, "utf8")
            memory.set(key, code)
            return { contents: code, loader: "js" }
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
              console.warn("[build] could not read the solid cache", diskPath, error)
            }
          }
        }

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
}

function write(diskPath: string, code: string) {
  // Write through a temp file so a concurrent build in the same worktree never reads a partial entry.
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
  return JSON.parse(readFileSync(Bun.resolveSync(`${name}/package.json`, from), "utf8")).version ?? ""
}

function prepare(cacheDir: string) {
  try {
    mkdirSync(cacheDir, { recursive: true })
    return true
  } catch (error) {
    console.warn("[build] solid transform cache disabled", error)
    return false
  }
}
