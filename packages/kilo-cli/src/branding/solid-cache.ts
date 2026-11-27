import type { transformAsync } from "@babel/core"
import { plugin, type BunPlugin } from "bun"
import { readFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"
import {
  defaultCacheDir,
  hashParts,
  isInsideRepo,
  packageDir,
  packageVersion,
  prepareCacheDir,
  readCached,
  writeCached,
} from "./cache"

// Coordinates with `@opentui/solid/bun-plugin`'s idempotency guard (`ensureSolidTransformPlugin`) so later
// runtime plugin configuration updates `state.runtime` without double-registering an uncached Babel plugin.
const solidTransformStateKey = Symbol.for("opentui.solid.transform")
const tsPattern = /\.[cm]?tsx?$/
const jsxFilter = /^(?!.*[/\\]node_modules[/\\]).*\.[cm]?[jt]sx(?:[?#].*)?$/

type SolidRuntimeConfig = {
  moduleName?: string
  resolvePath?: (specifier: string) => string | undefined
}

type SolidTransformState = {
  installed: boolean
  runtime?: SolidRuntimeConfig
}

function solidTransformState(): SolidTransformState {
  const holder = globalThis as Record<symbol, SolidTransformState | undefined>
  const existing = holder[solidTransformStateKey]
  if (existing) return existing
  const created: SolidTransformState = { installed: false }
  holder[solidTransformStateKey] = created
  return created
}

function stripQueryAndHash(filePath: string) {
  const searchIndex = filePath.indexOf("?")
  const hashIndex = filePath.indexOf("#")
  const end = [searchIndex, hashIndex].filter((index) => index >= 0).sort((a, b) => a - b)[0]
  return end === undefined ? filePath : filePath.slice(0, end)
}

let cachedToolchain: string | undefined

function solidToolchain() {
  if (cachedToolchain !== undefined) return cachedToolchain
  const solidDir = packageDir("babel-preset-solid", import.meta.dir)
  cachedToolchain = hashParts(
    readFileSync(import.meta.path, "utf8"),
    packageVersion("@babel/core", import.meta.dir),
    packageVersion("babel-preset-solid", import.meta.dir),
    packageVersion("@babel/preset-typescript", import.meta.dir),
    packageVersion("babel-plugin-jsx-dom-expressions", solidDir),
    packageVersion("@opentui/solid", import.meta.dir),
  )
  return cachedToolchain
}

let babelDeps:
  | Promise<{
      transformAsync: typeof transformAsync
      solid: unknown
      typescript: unknown
    }>
  | undefined

function loadBabel() {
  babelDeps ??= Promise.all([
    import("@babel/core"),
    import("babel-preset-solid"),
    import("@babel/preset-typescript"),
  ]).then(([babel, solid, typescript]) => ({
    transformAsync: babel.transformAsync,
    solid: solid.default,
    typescript: typescript.default,
  }))
  return babelDeps
}

async function transformUncached(source: string, filename: string, moduleName: string) {
  const deps = await loadBabel()
  const presets: unknown[] = [[deps.solid, { moduleName, generate: "universal" }]]
  if (tsPattern.test(filename)) presets.push([deps.typescript])
  const result = await deps.transformAsync(source, {
    filename,
    configFile: false,
    babelrc: false,
    plugins: [],
    presets: presets as never,
  })
  return result?.code ?? source
}

async function transformWithResolver(
  source: string,
  filename: string,
  moduleName: string,
  resolvePath: (specifier: string) => string | undefined,
) {
  const bunPluginPath = Bun.resolveSync("@opentui/solid/bun-plugin", import.meta.dir)
  const mod = (await import(path.join(path.dirname(bunPluginPath), "solid-transform.js"))) as {
    transformSolidSource: (
      code: string,
      options: { filename: string; moduleName?: string; resolvePath?: (specifier: string) => string | undefined },
    ) => Promise<string>
  }
  return mod.transformSolidSource(source, { filename, moduleName, resolvePath })
}

export function createCachedSolidTransformPlugin(options: { cacheDir?: string; disk?: boolean } = {}): BunPlugin {
  const explicitCache = options.cacheDir !== undefined
  const cacheDir = options.cacheDir ?? defaultCacheDir("kilo-cli-solid")
  const useDisk = options.disk ?? (explicitCache || (process.env.CI !== "true" && process.env.CI !== "1"))
  const memory = new Map<string, string>()
  let diskReady: boolean | undefined

  const disk = () => {
    if (!useDisk) return false
    if (diskReady === undefined) diskReady = prepareCacheDir(cacheDir)
    return diskReady
  }

  return {
    name: "bun-plugin-solid",
    setup(build) {
      build.onLoad({ filter: /[/\\]node_modules[/\\]solid-js[/\\]dist[/\\]server\.js(?:[?#].*)?$/ }, async (args) => {
        const target = stripQueryAndHash(args.path).replace("server.js", "solid.js")
        return { contents: await readFile(target, "utf8"), loader: "js" }
      })
      build.onLoad(
        { filter: /[/\\]node_modules[/\\]solid-js[/\\]store[/\\]dist[/\\]server\.js(?:[?#].*)?$/ },
        async (args) => {
          const target = stripQueryAndHash(args.path).replace("server.js", "store.js")
          return { contents: await readFile(target, "utf8"), loader: "js" }
        },
      )
      build.onLoad({ filter: jsxFilter }, async (args) => {
        const filename = stripQueryAndHash(args.path)
        const source = await readFile(filename, "utf8")
        const runtime = solidTransformState().runtime
        const moduleName = runtime?.moduleName ?? "@opentui/solid"
        if (runtime?.resolvePath) {
          return {
            contents: await transformWithResolver(source, filename, moduleName, runtime.resolvePath),
            loader: "js",
          }
        }
        const cacheable = explicitCache || isInsideRepo(filename)
        const key = cacheable ? hashParts("solid-universal", moduleName, filename, source, solidToolchain()) : undefined
        if (key) {
          const memHit = memory.get(key)
          if (memHit !== undefined) return { contents: memHit, loader: "js" }
          if (disk()) {
            const diskHit = readCached(cacheDir, key, "js")
            if (diskHit !== undefined) {
              memory.set(key, diskHit)
              return { contents: diskHit, loader: "js" }
            }
          }
        }
        const contents = await transformUncached(source, filename, moduleName)
        if (key) {
          memory.set(key, contents)
          if (disk()) writeCached(cacheDir, key, "js", contents)
        }
        return { contents, loader: "js" }
      })
    },
  }
}

export function ensureCachedSolidTransformPlugin(options: { cacheDir?: string } = {}) {
  const state = solidTransformState()
  if (state.installed) return false
  plugin(createCachedSolidTransformPlugin(options))
  state.installed = true
  return true
}
