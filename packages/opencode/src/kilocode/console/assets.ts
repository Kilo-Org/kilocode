import path from "path"
import { existsSync } from "fs"
import { readFile, stat } from "fs/promises"
import * as Log from "@opencode-ai/core/util/log"

export namespace ConsoleAssets {
  const log = Log.create({ service: "console.assets" })
  const prefix = "/console"
  const base = "/console/"
  const builds = new Map<string, Promise<string | undefined>>()

  export type Result = { file: string } | { missing: true }

  export function match(input: string) {
    return input === prefix || input.startsWith(`${prefix}/`)
  }

  export async function resolve(input: string): Promise<Result | undefined> {
    if (!match(input)) return undefined

    const root = await dir()
    if (!root) return { missing: true }

    const target = route(input)
    if (!target) return { missing: true }

    const direct = await find(root, target.rel)
    if (direct) return { file: direct }

    if (!target.fallback) return { missing: true }

    const index = await find(root, "index.html")
    if (!index) return { missing: true }
    return { file: index }
  }

  async function dir() {
    const override = process.env.KILO_CONSOLE_ASSET_DIR
    if (override && (await ready(override, false))) return override

    const copied = path.join(path.dirname(process.execPath), "console")
    if (await ready(copied, false)) return copied

    const app = source()
    const out = path.join(app, "dist")
    if (!existsSync(path.join(app, "package.json"))) return undefined
    if (await ready(out, true)) return out

    return await build(app, out)
  }

  function source() {
    return path.resolve(import.meta.dirname, "../../../../kilo-console")
  }

  async function build(app: string, out: string) {
    const cached = builds.get(app)
    if (cached) return await cached

    const run = runBuild(app, out).catch((err) => {
      log.warn("failed to build Kilo Console assets", { err })
      return undefined
    })
    builds.set(app, run)
    return await run
  }

  async function runBuild(app: string, out: string) {
    log.info("building Kilo Console assets", { app })
    const proc = Bun.spawn([process.execPath, "run", "build"], {
      cwd: app,
      env: { ...process.env, KILO_CONSOLE_BASE: base },
      stdout: "pipe",
      stderr: "pipe",
      windowsHide: true,
    })
    const [stdout, stderr, code] = await Promise.all([
      proc.stdout ? new Response(proc.stdout).text() : Promise.resolve(""),
      proc.stderr ? new Response(proc.stderr).text() : Promise.resolve(""),
      proc.exited,
    ])
    if (code !== 0) throw new Error(`Kilo Console build failed with exit code ${code}: ${stderr || stdout}`)
    if (!(await ready(out, true))) throw new Error("Kilo Console build did not produce /console assets")
    return out
  }

  async function ready(dir: string, verify: boolean) {
    const index = path.join(dir, "index.html")
    if (!(await exists(index))) return false
    if (!verify) return true
    const html = await readFile(index, "utf8").catch(() => "")
    return html.includes(base)
  }

  async function exists(file: string) {
    const info = await stat(file).catch(() => undefined)
    return info?.isFile() ?? false
  }

  async function find(root: string, rel: string) {
    const file = safe(root, rel)
    if (!file) return undefined
    if (!(await exists(file))) return undefined
    return file
  }

  function safe(root: string, rel: string) {
    if (rel.includes("\0")) return undefined
    const file = path.resolve(root, rel)
    const back = path.relative(root, file)
    if (back === "") return file
    if (back.startsWith("..") || path.isAbsolute(back)) return undefined
    return file
  }

  function route(input: string) {
    const raw = input === prefix ? "" : input.slice(prefix.length)
    const trimmed = raw.replace(/^\/+/, "")
    if (!trimmed) return { rel: "index.html", fallback: false }

    const decoded = decode(trimmed)
    if (!decoded) return undefined

    const rel = decoded.replace(/\\/g, "/")
    if (rel.split("/").some((part) => part === "..")) return undefined
    return { rel, fallback: path.extname(rel) === "" }
  }

  function decode(input: string) {
    try {
      return decodeURIComponent(input)
    } catch (_err) {
      return undefined
    }
  }
}
