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

/**
 * Resolve effective display shortcuts for the given command IDs.
 *
 * Reads the active VS Code profile's `keybindings.json` (derived from the extension's
 * globalStorageUri so it works across profiles) and applies user entries on top of
 * the extension's declared defaults. Respects `-command` unbinds.
 */
export async function keybindings(ids: string[], context?: vscode.ExtensionContext) {
  const result: Record<string, string> = {}
  const user = await readUserKeybindings(context)
  for (const id of ids) {
    const binding = resolve(id, user)
    if (binding) {
      result[id] = binding
    }
  }
  return result
}

function resolve(id: string, user: KeybindingEntry[]) {
  const defaults = extensionDefaults(id)
  const platformDefault = process.platform === "darwin" ? defaults?.mac || defaults?.key : defaults?.key
  const effective = applyOverrides(id, user, platformDefault)
  if (!effective) {
    return undefined
  }
  return pretty(effective)
}

function extensionDefaults(id: string): KeybindingEntry | undefined {
  const ext = vscode.extensions.getExtension("kilocode.kilo-code")
  const bindings = (ext?.packageJSON?.contributes?.keybindings ?? []) as KeybindingEntry[]
  return bindings.find((item) => item.command === id)
}

/**
 * Walk user keybindings in order, applying override semantics:
 *  - `command: id`      → sets the effective binding to this entry's key
 *  - `command: -id`     → removes the current binding (matches any bound key for display)
 *
 * Later entries win, matching VS Code's "last wins" resolution for display purposes.
 */
function applyOverrides(id: string, user: KeybindingEntry[], fallback: string | undefined) {
  let current = fallback
  const unbind = `-${id}`
  for (const entry of user) {
    if (entry.command === id && entry.key) {
      current = entry.key
    } else if (entry.command === unbind) {
      current = undefined
    }
  }
  return current
}

async function readUserKeybindings(context?: vscode.ExtensionContext) {
  const file = keybindingsPath(context)
  if (!file) {
    return []
  }
  const value = await read(file)
  if (Array.isArray(value)) {
    return value as KeybindingEntry[]
  }
  return []
}

/**
 * Derive the active profile's `keybindings.json` from the extension's globalStorageUri.
 *
 * Layouts (per VS Code Profiles):
 *   default profile:  <root>/User/globalStorage/<ext-id>          → <root>/User/keybindings.json
 *   custom profile:   <root>/User/profiles/<id>/globalStorage/... → <root>/User/profiles/<id>/keybindings.json
 *
 * Either way, walking up two directories from globalStorageUri and appending
 * `keybindings.json` lands us on the right file for the currently active profile.
 */
function keybindingsPath(context?: vscode.ExtensionContext) {
  if (!context) {
    return undefined
  }
  return path.join(context.globalStorageUri.fsPath, "..", "..", "keybindings.json")
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
