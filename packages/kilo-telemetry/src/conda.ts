import { readdir } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

const TOKEN = /^[A-Za-z0-9_-]{22}$/
const SETTING = /^anaconda_anon_usage\s*:\s*(.*?)\s*(#.*)?$/
const MAX_CONFIG_CHARS = 1_048_576

// anaconda-anon-usage defaults this to true and only drops `c/<id>` when it is set false.
// https://github.com/anaconda/anaconda-anon-usage/blob/main/anaconda_anon_usage/patch.py
function unquote(raw: string): string {
  const value = raw.trim()
  const quoted =
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  return quoted ? value.slice(1, -1).trim() : value
}

function bool(raw: string): boolean | undefined {
  switch (unquote(raw).toLowerCase()) {
    case "true":
    case "yes":
    case "on":
    case "y":
    case "1":
      return true
    case "false":
    case "no":
    case "off":
    case "n":
    case "0":
      return false
    default:
      return undefined
  }
}

// Same order as conda's documented SEARCH_PATH. Later files override earlier ones
// unless an earlier value is marked `#!final`, which also blocks the env var.
// https://docs.conda.io/projects/conda/en/stable/user-guide/configuration/use-condarc.html
function sources(env: NodeJS.ProcessEnv, home: string): string[] {
  const entries =
    process.platform === "win32"
      ? ["C:/ProgramData/conda/.condarc", "C:/ProgramData/conda/condarc", "C:/ProgramData/conda/condarc.d"]
      : [
          "/etc/conda/.condarc",
          "/etc/conda/condarc",
          "/etc/conda/condarc.d/",
          "/var/lib/conda/.condarc",
          "/var/lib/conda/condarc",
          "/var/lib/conda/condarc.d/",
        ]
  const add = (root: string | undefined, names: string[]) => {
    if (!root) return
    for (const name of names) entries.push(join(root, name))
  }
  add(env.CONDA_ROOT, [".condarc", "condarc", "condarc.d"])
  if (env.XDG_CONFIG_HOME) add(join(env.XDG_CONFIG_HOME, "conda"), [".condarc", "condarc", "condarc.d"])
  add(join(home, ".config", "conda"), [".condarc", "condarc", "condarc.d"])
  add(join(home, ".conda"), [".condarc", "condarc", "condarc.d"])
  entries.push(join(home, ".condarc"))
  add(env.CONDA_PREFIX, [".condarc", "condarc", "condarc.d"])
  if (env.CONDARC && condarcName(env.CONDARC)) entries.push(env.CONDARC)
  return entries
}

function condarcName(path: string): boolean {
  const base = path.split(/[\\/]/).pop() ?? ""
  return base === ".condarc" || base === "condarc" || base.endsWith(".yml") || base.endsWith(".yaml")
}

function directoryEntry(entry: string): boolean {
  return entry.endsWith("/") || entry.endsWith("\\") || entry.endsWith("condarc.d")
}

async function filesIn(entry: string): Promise<string[] | undefined> {
  if (!directoryEntry(entry)) return [entry]
  const path = entry.replace(/[\\/]+$/, "")
  try {
    const names = await readdir(path)
    return names
      .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
      .sort()
      .map((name) => join(path, name))
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined
    if (code === "ENOENT") return []
    return undefined
  }
}

type Setting = { value: boolean; final: boolean }

function setting(text: string): Setting | "invalid" | undefined {
  let found: Setting | "invalid" | undefined
  for (const raw of text.split(/\r?\n/)) {
    if (!raw || raw.startsWith("#") || /^\s/.test(raw)) continue
    const match = SETTING.exec(raw.trim())
    if (!match) continue
    const value = bool(match[1] ?? "")
    const final = /#!final\b/.test(match[2] ?? "")
    found = value === undefined ? "invalid" : { value, final }
  }
  return found
}

async function readConfig(path: string): Promise<string | undefined | "invalid"> {
  const file = Bun.file(path)
  if (!(await file.exists())) return undefined
  try {
    const text = await file.text()
    if (text.length > MAX_CONFIG_CHARS) return "invalid"
    return text
  } catch {
    // A directory or unreadable file at a condarc path is not a safe "telemetry on".
    return "invalid"
  }
}

// True when conda would omit the client token. Unreadable or unparseable config fails closed
// so a stale ~/.conda/aau_token is not collected after opt-out.
async function optedOut(env: NodeJS.ProcessEnv, home: string): Promise<boolean> {
  let value: boolean | undefined
  let frozen = false
  for (const entry of sources(env, home)) {
    if (frozen) break
    const files = await filesIn(entry)
    if (files === undefined) return true
    for (const file of files) {
      if (frozen) break
      const text = await readConfig(file)
      if (text === undefined) continue
      if (text === "invalid") return true
      const parsed = setting(text)
      if (parsed === undefined) continue
      if (parsed === "invalid") return true
      value = parsed.value
      frozen = parsed.final
    }
  }
  if (!frozen) {
    const raw = env.CONDA_ANACONDA_ANON_USAGE
    if (raw !== undefined) {
      const parsed = bool(raw)
      if (parsed === undefined) return true
      value = parsed
    }
  }
  return value === false
}

export namespace Conda {
  export async function clientToken(): Promise<string | undefined> {
    try {
      // The token file is absent for people who have never run conda. Do not create one.
      const env = process.env
      const home = (process.platform === "win32" ? env.USERPROFILE : env.HOME) || homedir()
      const file = Bun.file(join(home, ".conda", "aau_token"))
      if (!(await file.exists())) return undefined
      const token = (await file.text()).trim()
      if (!TOKEN.test(token)) return undefined
      // Reading the file alone is wrong: the token remains after anaconda_anon_usage is turned off.
      // File reads stay on the startup path; they replace `conda info`, which was blocking serve.
      if (await optedOut(env, home)) return undefined
      return token
    } catch {
      // Conda is optional. A missing token or unreadable config has no join key.
      return undefined
    }
  }
}
