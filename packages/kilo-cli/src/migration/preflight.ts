import { readdirSync, statfsSync, statSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { KiloGlobalResilience } from "../global-resilience"
import { checkResourceOnly } from "./resource-only"
import { statePaths } from "./state-paths"

/** Inventory the selected profile without opening SQLite. The separate schema probe
 * uses an immutable main-file read or a bounded private WAL copy. */
export function preflight(environment: NodeJS.ProcessEnv, cwd = process.cwd()) {
  const env = { ...environment }
  KiloGlobalResilience.cleanEnv(env)
  const home = KiloGlobalResilience.resolveHome(env, homedir())
  const base = path.resolve(env.XDG_DATA_HOME || path.join(home, ".local", "share"))
  const configBase = path.resolve(env.XDG_CONFIG_HOME || path.join(home, ".config"))
  const selected = env.KILO_DB ?? env.OPENCODE_DB
  if (selected === ":memory:") throw new Error("Cannot migrate an in-memory session store")
  const source = legacySource(path.join(base, "kilo"), selected)
  const sourceBytes = fileSize(source)
  const plan = {
    version: 1 as const,
    status: sourceBytes === undefined ? ("absent" as const) : ("required" as const),
    source,
    home: path.resolve(env.OPENCODE_TEST_HOME || env.KILO_TEST_HOME || home),
    ...statePaths(env, base, home),
    configBase,
    legacyData: path.join(base, "kilo"),
    authFiles: [path.join(base, "kilo", "auth.json")],
    legacyConfig: path.resolve((env.KILO_CONFIG_DIR ?? env.OPENCODE_CONFIG_DIR) || path.join(configBase, "kilo")),
    legacyDefaultConfig: path.join(configBase, "kilo"),
    legacyConfigFile: absolute(env.KILO_CONFIG ?? env.OPENCODE_CONFIG),
    sourceBytes: sourceBytes ?? 0,
    walBytes: fileSize(`${source}-wal`) ?? 0,
    backup: `${source}.pre-v2`,
    availableBytes: available(path.dirname(source)),
  }
  if (plan.status === "absent") checkResourceOnly(plan, cwd)
  return plan
}

function absolute(file: string | undefined) {
  return file ? path.resolve(file) : undefined
}

/** A channel may have both its current filename and its older fallback, with different histories.
 * Do not infer that either is disposable, even when the caller normally opens a specific KILO_DB. */
function legacySource(dir: string, override?: string) {
  const selected = path.resolve(dir, override || "kilo.db")
  // An explicit selection or the canonical install selects exactly one store. Other channels stay untouched.
  if (override || statSync(selected, { throwIfNoEntry: false })) return selected
  const names = statSync(dir, { throwIfNoEntry: false }) ? readdirSync(dir) : []
  const candidates = names
    .filter((name) => name === "kilo.db" || /^(?:kilo|opencode)-[a-zA-Z0-9._-]+\.db$/.test(name))
    .map((name) => path.join(dir, name))
    .sort()
  if (candidates.length > 1)
    throw new Error(`Cannot switch profiles until you select a v1 database with KILO_DB:\n${candidates.join("\n")}`)
  return candidates[0] ?? selected
}

function fileSize(file: string) {
  const stat = statSync(file, { throwIfNoEntry: false })
  if (stat && !stat.isFile()) throw new Error(`Expected a regular file at ${file}`)
  return stat?.size
}

function available(dir: string) {
  let ancestor = dir
  while (!statSync(ancestor, { throwIfNoEntry: false })) {
    const parent = path.dirname(ancestor)
    if (parent === ancestor) throw new Error(`Cannot locate filesystem for ${dir}`)
    ancestor = parent
  }
  const fs = statfsSync(ancestor)
  return fs.bavail * fs.bsize
}

export async function migrationCommand(args: string[]) {
  try {
    if (args.length === 1 && args[0] === "decline")
      return void (await Bun.write(Bun.stdout, '{"version":1,"status":"declined"}\n'))
    const plan = preflight(process.env)
    if (args.length === 1 && args[0] === "preflight") {
      const { migrationStatus } = await import("./cutover")
      return void (await Bun.write(Bun.stdout, `${JSON.stringify(migrationStatus(plan))}\n`))
    }
    const output = (event: object) => process.stdout.write(`${JSON.stringify(event)}\n`)
    if (args.length === 1 && args[0] === "observe") {
      const { observeCutover } = await import("./cutover")
      return await observeCutover(plan, output)
    }
    if (args.length === 2 && args[1] === "--accept-jetbrains-breakage") {
      const { applyCutover, recoverCutover } = await import("./cutover")
      if (args[0] === "apply") return await applyCutover(plan, output)
      if (args[0] === "recover") return await recoverCutover(plan, output)
    }
    throw new Error("Usage: migrate preflight | decline | observe | {apply,recover} --accept-jetbrains-breakage")
  } catch (error) {
    await Bun.write(Bun.stderr, `${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
