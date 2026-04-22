import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"

export type KeybindingEntry = {
  key?: string
  command?: string
  mac?: string
}

const MAC: Record<string, string> = {
  cmd: "Cmd",
  meta: "Cmd",
  ctrl: "Ctrl",
  alt: "Option",
  option: "Option",
  shift: "Shift",
}

const OTHER: Record<string, string> = {
  cmd: "Win",
  meta: "Win",
  ctrl: "Ctrl",
  alt: "Alt",
  shift: "Shift",
}

const SPECIAL: Record<string, string> = {
  left: "Left",
  right: "Right",
  up: "Up",
  down: "Down",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  insert: "Insert",
  delete: "Delete",
  backspace: "Backspace",
  tab: "Tab",
  enter: "Enter",
  escape: "Escape",
  space: "Space",
}

export async function keybindings(ids: string[]) {
  const result: Record<string, string> = {}
  const user = await readUserKeybindings()
  for (const id of ids) {
    const binding = bindingFor(id, user)
    if (binding) {
      result[id] = binding
    }
  }
  return result
}

function bindingFor(id: string, user: KeybindingEntry[]) {
  const entry = user.find((item) => item.command === id)
  if (entry) {
    if (!entry.key) {
      return undefined
    }
    return pretty(entry.key)
  }

  const ext = vscode.extensions.getExtension("kilocode.kilo-code")
  const bindings = (ext?.packageJSON?.contributes?.keybindings ?? []) as KeybindingEntry[]
  const fallback = bindings.find((item) => item.command === id)
  const raw = process.platform === "darwin" ? fallback?.mac || fallback?.key : fallback?.key
  if (!raw) {
    return undefined
  }
  return pretty(raw)
}

async function readUserKeybindings() {
  const files = await candidates()
  for (const file of files) {
    const value = await read(file)
    if (Array.isArray(value)) {
      return value as KeybindingEntry[]
    }
  }
  return []
}

async function candidates() {
  const root = process.env.VSCODE_PORTABLE ? path.join(process.env.VSCODE_PORTABLE, "user-data") : dataDir()
  const dir = path.join(root, "User")
  const files = [path.join(dir, "keybindings.json")]
  const profiles = path.join(dir, "profiles")
  const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(profiles)).then(
    (items) => items,
    () => [],
  )
  return files.concat(
    entries
      .filter((entry) => entry[1] === vscode.FileType.Directory)
      .map((entry) => path.join(profiles, entry[0], "keybindings.json")),
  )
}

function dataDir() {
  const home = os.homedir()
  const product = productDir()
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), product)
  }
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", product)
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), product)
}

function productDir() {
  const name = vscode.env.appName.toLowerCase()
  if (name.includes("insiders")) {
    return "Code - Insiders"
  }
  if (name.includes("vscodium")) {
    return "VSCodium"
  }
  if (name.includes("cursor")) {
    return "Cursor"
  }
  if (name.includes("windsurf")) {
    return "Windsurf"
  }
  if (name.includes("oss")) {
    return "Code - OSS"
  }
  return "Code"
}

async function read(file: string) {
  const data = await vscode.workspace.fs.readFile(vscode.Uri.file(file)).then(
    (bytes) => Buffer.from(bytes).toString("utf8"),
    () => "",
  )
  if (!data) {
    return undefined
  }
  try {
    return JSON.parse(strip(data))
  } catch (err) {
    console.warn("[Kilo New] Failed to parse keybindings.json", { file, err })
    return undefined
  }
}

function strip(input: string) {
  return input.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1")
}

function pretty(input: string) {
  return input
    .split(" ")
    .filter(Boolean)
    .map((chord) => chord.split("+").map(token).join("+"))
    .join(", ")
}

function token(input: string) {
  const value = input.toLowerCase()
  const map = process.platform === "darwin" ? MAC : OTHER
  const modifier = map[value]
  if (modifier) {
    return modifier
  }
  const special = SPECIAL[value]
  if (special) {
    return special
  }
  if (/^f\d{1,2}$/.test(value)) {
    return value.toUpperCase()
  }
  if (value.length === 1) {
    return value.toUpperCase()
  }
  return value.charAt(0).toUpperCase() + value.slice(1)
}
