import { existsSync } from "fs"
import * as os from "os"
import * as path from "path"

export type Scope = "global" | "local"

export interface Entry {
  file?: string
  name: string
  source: string
  exists: boolean
  loaded: boolean
  legacy?: boolean
  recommended?: boolean
  virtual?: boolean
}

const SCHEMA = "https://app.kilo.ai/config.json"

const MODERN = ["kilo.jsonc", "kilo.json"]
const LEGACY = ["opencode.jsonc", "opencode.json"]
const FILES = [...MODERN, ...LEGACY]
const GLOBAL = ["kilo.jsonc", "kilo.json", "opencode.jsonc", "opencode.json", "config.json"]
const HOME = [".kilo", ".kilocode", ".opencode"]

function row(file: string, source: string, loaded = true, recommended = false): Entry {
  const name = path.basename(file)
  return {
    file,
    name,
    source,
    exists: existsSync(file),
    loaded: loaded && existsSync(file),
    legacy: name.startsWith("opencode") || name === "config.json" || file.includes(`${path.sep}.kilocode${path.sep}`),
    recommended,
  }
}

function ensure(list: Entry[], file: string, source: string) {
  if (list.some((item) => item.file === file)) return list
  return [...list, row(file, source, true, true)]
}

export function globalFiles() {
  const root = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "kilo")
  const base = GLOBAL.map((file) => row(path.join(root, file), "XDG global config")).filter((item) => item.exists)
  const dirs = HOME.flatMap((dir) => {
    const base = path.join(os.homedir(), dir)
    if (!existsSync(base)) return []
    return FILES.map((file) => row(path.join(base, file), `Home ${dir} config`)).filter((item) => item.exists)
  })
  const env = process.env.KILO_CONFIG ? [row(process.env.KILO_CONFIG, "KILO_CONFIG environment file")] : []
  const dir = process.env.KILO_CONFIG_DIR
    ? ensure(
        FILES.map((file) => row(path.join(process.env.KILO_CONFIG_DIR!, file), "KILO_CONFIG_DIR")).filter(
          (item) => item.exists,
        ),
        path.join(process.env.KILO_CONFIG_DIR, "kilo.jsonc"),
        "KILO_CONFIG_DIR",
      )
    : []
  const virtual: Entry[] = process.env.KILO_CONFIG_CONTENT
    ? [
        {
          name: "KILO_CONFIG_CONTENT",
          source: "Inline environment config",
          exists: true,
          loaded: true,
          virtual: true,
        },
      ]
    : []

  return ensure([...base, ...dirs, ...env, ...dir, ...virtual], path.join(root, "kilo.jsonc"), "XDG global config")
}

export function localFiles(root: string) {
  const enabled = !process.env.KILO_DISABLE_PROJECT_CONFIG
  const dirs = [path.join(root, ".kilo"), root, path.join(root, ".kilocode"), path.join(root, ".opencode")]
  const list = dirs.flatMap((dir) => FILES.map((file) => row(path.join(dir, file), localSource(root, dir), enabled)))
  return ensure(
    list.filter((item) => item.exists),
    path.join(root, ".kilo", "kilo.jsonc"),
    "Project .kilo config",
  ).map((item) => (enabled ? item : { ...item, loaded: false }))
}

function localSource(root: string, dir: string) {
  if (dir === root) return "Project root config"
  if (dir.endsWith(`${path.sep}.kilo`)) return "Project .kilo config"
  if (dir.endsWith(`${path.sep}.kilocode`)) return "Legacy .kilocode config"
  return "Legacy .opencode config"
}

export function content() {
  return `{
  "$schema": "${SCHEMA}"
}
`
}
