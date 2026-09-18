import { realpathSync } from "node:fs"
import os from "os"
import path from "path"

export const message =
  "Automatic indexing is disabled in home and filesystem root directories. Open a project folder to enable indexing. File tools remain available."

function root(directory: string, api: typeof path.posix) {
  if (!api.isAbsolute(directory)) return false
  return api.normalize(directory) === api.normalize(api.parse(directory).root)
}

function real(directory: string) {
  try {
    return realpathSync.native(directory)
  } catch {
    return path.resolve(directory)
  }
}

export function allowed(directory: string, home = (process.env.KILO_TEST_HOME ?? os.homedir()).trim()) {
  const value = path.win32.normalize(directory)
  const prefix = "\\\\?\\UNC\\"
  const windows = value.toUpperCase().startsWith(prefix) ? `\\\\${value.slice(prefix.length)}` : value
  if (root(directory, path.posix) || root(windows, path.win32)) return false
  const resolved = real(directory)
  if (root(resolved, path)) return false
  const base = real(home)
  return process.platform === "win32" ? resolved.toLowerCase() !== base.toLowerCase() : resolved !== base
}

export function notices(directory: string) {
  return allowed(directory) ? [] : [{ path: directory, message }]
}
