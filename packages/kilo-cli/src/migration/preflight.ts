import { readdirSync, statfsSync, statSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { KiloGlobalResilience } from "../global-resilience"
import { pilotEnabled } from "./pilot"
import { checkResourceOnly } from "./resource-only"

/** Filesystem inventory only. Opening even a read-only SQLite connection to a live WAL
 * can change the shared-memory file. Schema validation belongs after consent. */
export function preflight(environment: NodeJS.ProcessEnv, cwd = process.cwd()) {
  const env = { ...environment }
  KiloGlobalResilience.cleanEnv(env)
  const home = KiloGlobalResilience.resolveHome(env, homedir())
  const base = path.resolve(env.XDG_DATA_HOME || path.join(home, ".local", "share"))
  const preview = path.join(base, "kilo2")
  const configBase = path.resolve(env.XDG_CONFIG_HOME || path.join(home, ".config"))
  const stateBase = path.resolve(env.XDG_STATE_HOME || path.join(home, ".local", "state"))
  const previewFile = env.KILO2_CONFIG ?? env.OPENCODE_CONFIG
  if (env.KILO_DB === ":memory:") throw new Error("Cannot migrate an in-memory session store")
  const source = legacySource(path.join(base, "kilo"), env.KILO_DB)
  const sourceBytes = fileSize(source)
  const plan = {
    version: 1 as const,
    status: sourceBytes === undefined ? ("absent" as const) : ("required" as const),
    source,
    home: path.resolve(env.OPENCODE_TEST_HOME || env.KILO_TEST_HOME || home),
    stateBase,
    configBase,
    legacyState: path.join(stateBase, "kilo"),
    legacyData: path.join(base, "kilo"),
    authFiles: [path.join(base, "kilo", "auth.json"), path.join(preview, "auth.json")],
    legacyConfig: path.resolve(env.KILO_CONFIG_DIR || path.join(configBase, "kilo")),
    legacyDefaultConfig: path.join(configBase, "kilo"),
    previewConfig: path.resolve((env.KILO2_CONFIG_DIR ?? env.OPENCODE_CONFIG_DIR) || path.join(configBase, "kilo2")),
    legacyConfigFile: env.KILO_CONFIG ? path.resolve(env.KILO_CONFIG) : undefined,
    previewConfigFile: previewFile ? path.resolve(previewFile) : undefined,
    sourceBytes: sourceBytes ?? 0,
    walBytes: fileSize(`${source}-wal`) ?? 0,
    ...previewInventory(preview, env.KILO2_DB || env.OPENCODE_DB, source),
    backup: `${source}.pre-v2`,
    availableBytes: available(path.dirname(source)),
  }
  if (plan.status === "absent") checkResourceOnly(plan, cwd)
  return plan
}

function previewInventory(dir: string, selected: string | undefined, source: string) {
  const file = selected && selected !== ":memory:" ? path.resolve(dir, selected) : selected
  const extra = file && file !== ":memory:" ? [file] : []
  const names = statSync(dir, { throwIfNoEntry: false }) ? readdirSync(dir) : []
  const files = names
    .filter((name) => /^(?:kilo2.*|opencode(?:-.+)?)\.db$/.test(name))
    .map((name) => path.join(dir, name))
  return {
    previewDatabase: file && file !== source ? file : null,
    previewStores: [...new Set([...files, ...extra])]
      .filter((file) => file !== source && fileSize(file) !== undefined)
      .sort(),
  }
}

/** A channel may have both its current filename and its older fallback, with different histories.
 * Do not infer that either is disposable, even when the caller normally opens a specific KILO_DB. */
function legacySource(dir: string, override?: string) {
  const selected = path.resolve(dir, override || "kilo.db")
  const names = statSync(dir, { throwIfNoEntry: false }) ? readdirSync(dir) : []
  const discovered = names
    .filter((name) => name === "kilo.db" || /^(?:kilo|opencode)-[a-zA-Z0-9._-]+\.db$/.test(name))
    .map((name) => path.join(dir, name))
  const candidates = [...new Set(override ? [...discovered, selected] : discovered)].sort()
  if (candidates.length > 1)
    throw new Error(`Cannot switch profiles until these v1 database paths are reconciled:\n${candidates.join("\n")}`)
  return candidates[0] ?? selected
}

/** Explicit documents can have arbitrary names and relative references. Keep the selected
 * document in place; two different sources cannot both occupy the runtime's single file slot. */
export function explicitConfig(plan: ReturnType<typeof preflight>) {
  if (plan.legacyConfigFile && plan.previewConfigFile && plan.legacyConfigFile !== plan.previewConfigFile)
    throw new Error(
      `Conflicting explicit config files: ${plan.legacyConfigFile} and ${plan.previewConfigFile}. Reconcile the settings and point both overrides at the same file before switching.`,
    )
  return plan.legacyConfigFile ?? plan.previewConfigFile
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
      if (!pilotEnabled()) return void (await Bun.write(Bun.stdout, `${JSON.stringify(plan)}\n`))
      const { migrationStatus } = await import("./cutover")
      return void (await Bun.write(Bun.stdout, `${JSON.stringify(migrationStatus(plan))}\n`))
    }
    if (!pilotEnabled()) throw new Error("Profile cutover is disabled in this installation.")
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
