import { readFileSync, existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"

/** Private model settings. Values are never included in audit/config hashes. */
export function setting(name: string): string | undefined {
  if (process.env[name]) return process.env[name]
  const file = process.env.AUTOGUARD_ENV_FILE ?? path.join(os.homedir(), ".config", "autoguard", "models.env")
  if (!existsSync(file)) return
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (match?.[1] !== name) continue
    const value = match[2].replace(/^(["'])(.*)\1$/, "$2")
    return value || undefined
  }
}
