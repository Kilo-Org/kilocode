import type { BunPlugin } from "bun"
import { readdirSync, readFileSync } from "node:fs"
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
import { files } from "./files"

const logoFilter = /[/\\]packages[/\\]tui[/\\]src[/\\]logo\.ts$/
const brandingFilter = new RegExp(
  `[/\\\\]packages[/\\\\](?:${files.map((file) => file.replaceAll(".", "\\.").replaceAll("/", "[/\\\\]")).join("|")})$`,
)
const artPath = path.join(import.meta.dir, "logo-art.ts")

let cachedToolchain: string | undefined

// Computed lazily on first transform so processes that load no branded files pay zero filesystem cost.
// Scans every TypeScript file in this directory so newly added branding modules invalidate the cache automatically.
function brandingToolchain() {
  if (cachedToolchain !== undefined) return cachedToolchain
  const entries = readdirSync(import.meta.dir)
    .filter((name) => name.endsWith(".ts"))
    .toSorted()
  const sources = entries.flatMap((name) => [name, readFileSync(path.join(import.meta.dir, name), "utf8")])
  const configFiles = readFileSync(Bun.resolveSync("@opencode/util/kilocode/config/files", import.meta.dir), "utf8")
  const solidDir = packageDir("babel-preset-solid", import.meta.dir)
  cachedToolchain = hashParts(
    ...sources,
    configFiles,
    artPath,
    packageVersion("@babel/core", import.meta.dir),
    packageVersion("babel-preset-solid", import.meta.dir),
    packageVersion("@babel/preset-typescript", import.meta.dir),
    packageVersion("babel-plugin-jsx-dom-expressions", solidDir),
  )
  return cachedToolchain
}

function configMode() {
  return process.env.KILO_USE_RELEASE_CONFIG === "1" ? "release" : "v2"
}

function isCI() {
  return process.env.CI === "true" || process.env.CI === "1"
}

export function createBrandingPlugin(options: { cacheDir?: string; disk?: boolean } = {}): BunPlugin {
  const explicitCache = options.cacheDir !== undefined
  const cacheDir = options.cacheDir ?? defaultCacheDir("kilo-cli-branding")
  const useDisk = options.disk ?? (explicitCache || !isCI())
  const memory = new Map<string, string>()
  let diskReady: boolean | undefined

  const disk = () => {
    if (!useDisk) return false
    if (diskReady === undefined) diskReady = prepareCacheDir(cacheDir)
    return diskReady
  }

  const canCacheDisk = (filePath: string) => useDisk && (explicitCache || isInsideRepo(filePath)) && disk()

  return {
    name: "kilo-branding",
    setup(build) {
      build.onLoad({ filter: logoFilter }, async (args) => {
        const source = await Bun.file(args.path).text()
        const key = hashParts("logo", args.path, source, brandingToolchain())
        const memHit = memory.get(key)
        if (memHit !== undefined) return { loader: "ts", contents: memHit }
        const diskAllowed = canCacheDisk(args.path)
        const diskHit = diskAllowed ? readCached(cacheDir, key, "ts") : undefined
        if (diskHit !== undefined) {
          memory.set(key, diskHit)
          return { loader: "ts", contents: diskHit }
        }

        const { KiloBrandingStructural } = await import("./structural")
        const contents = KiloBrandingStructural.brandLogoModule(source, artPath)
        memory.set(key, contents)
        if (diskAllowed) writeCached(cacheDir, key, "ts", contents)
        return { loader: "ts", contents }
      })

      build.onLoad({ filter: brandingFilter }, async (args) => {
        const source = await Bun.file(args.path).text()
        const loader = args.path.endsWith(".txt") || args.path.endsWith(".tsx") ? "js" : "ts"
        const key = hashParts("file", configMode(), args.path, source, brandingToolchain())
        const memHit = memory.get(key)
        if (memHit !== undefined) return { loader, contents: memHit }
        const diskAllowed = canCacheDisk(args.path)
        const diskHit = diskAllowed ? readCached(cacheDir, key, loader) : undefined
        if (diskHit !== undefined) {
          memory.set(key, diskHit)
          return { loader, contents: diskHit }
        }

        const contents = await compileBranded(args.path, source)
        memory.set(key, contents)
        if (diskAllowed) writeCached(cacheDir, key, loader, contents)
        return { loader, contents }
      })
    },
  }
}

async function compileBranded(filePath: string, source: string) {
  const { KiloBranding } = await import("./text")
  const contents = KiloBranding.transform(filePath, source)
  if (filePath.endsWith(".txt")) return `export default ${JSON.stringify(contents)}`
  if (!filePath.endsWith(".tsx")) return contents
  const [{ transformAsync }, solid, typescript] = await Promise.all([
    import("@babel/core"),
    import("babel-preset-solid"),
    import("@babel/preset-typescript"),
  ])
  const result = await transformAsync(contents, {
    filename: filePath,
    configFile: false,
    babelrc: false,
    plugins: [],
    presets: [[solid.default, { moduleName: "@opentui/solid", generate: "universal" }], [typescript.default]],
  })
  const key = filePath.replaceAll("\\", "/").split("/packages/").at(-1) ?? filePath
  if (!result?.code) throw new Error(`Could not compile Kilo branding for ${key}`)
  return result.code
}

export const brandingPlugin: BunPlugin = createBrandingPlugin()
