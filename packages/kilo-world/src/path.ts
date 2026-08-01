import { homedir } from "node:os"
import path from "node:path"

export function resolvePath(file: string, dir?: string): string {
  const home = file === "~" ? homedir() : /^[~][\\/]/.test(file) ? path.join(homedir(), file.slice(2)) : file
  const expanded = home.replace(/%([^%]+)%|\$\{([^}]+)\}|\$([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, win, brace, unix) => {
    const key = win ?? brace ?? unix
    const value = process.env[key] ?? (win ? env(key) : undefined)
    return value ?? _
  })
  if (path.isAbsolute(expanded) || !dir) return path.normalize(expanded)
  return path.resolve(dir, expanded)
}

function env(key: string): string | undefined {
  const name = Object.keys(process.env).find((item) => item.toLowerCase() === key.toLowerCase())
  return name ? process.env[name] : undefined
}
