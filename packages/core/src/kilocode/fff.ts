import path from "path"

function root(directory: string, api: typeof path.posix) {
  if (!api.isAbsolute(directory)) return false
  return api.normalize(directory) === api.normalize(api.parse(directory).root)
}

export function allowed(directory: string) {
  const value = path.win32.normalize(directory)
  const prefix = "\\\\?\\UNC\\"
  const windows = value.toUpperCase().startsWith(prefix.toUpperCase()) ? `\\\\${value.slice(prefix.length)}` : value
  return !root(directory, path.posix) && !root(windows, path.win32)
}
