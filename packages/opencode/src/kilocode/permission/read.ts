import path from "path"
import { Wildcard } from "@/util/wildcard"
import { PermissionRule, type Rule } from "@/kilocode/permission/rule"

function guard(pattern: string) {
  if (Wildcard.match(pattern, "*.env.example")) return
  if (Wildcard.match(pattern, "*.env")) return "*.env"
  if (Wildcard.match(pattern, "*.env.*")) return "*.env.*"
}

const CONFIG_DIRS = [".kilo/", ".kilocode/", ".opencode/"]
const CONFIG_ROOT_FILES = new Set(["kilo.json", "kilo.jsonc", "opencode.json", "opencode.jsonc", "AGENTS.md"])
const EXCLUDED_SUBDIRS = ["plans/"]

function isConfigDir(pattern: string): boolean {
  const normalized = path.posix.normalize(pattern.replaceAll("\\", "/"))
  if (CONFIG_ROOT_FILES.has(normalized)) return true
  for (const dir of CONFIG_DIRS) {
    if (normalized.startsWith(dir)) {
      const remainder = normalized.slice(dir.length)
      if (EXCLUDED_SUBDIRS.some((sub) => remainder.startsWith(sub))) continue
      return true
    }
    const bare = dir.slice(0, -1)
    if (normalized === bare || normalized.endsWith("/" + bare)) return true
    const nested = normalized.indexOf("/" + dir)
    if (nested !== -1) {
      const remainder = normalized.slice(nested + 1 + dir.length)
      if (EXCLUDED_SUBDIRS.some((sub) => remainder.startsWith(sub))) continue
      return true
    }
  }
  return false
}

export namespace ReadPermission {
  export function harden(permission: string, pattern: string, rule: Rule): Rule {
    if (permission !== "read") return rule
    if (rule.action !== "allow") return rule
    const envMatch = guard(pattern)
    if (envMatch) {
      if (!PermissionRule.broad(rule)) return rule
      return { permission, pattern: envMatch, action: "ask" }
    }
    if (isConfigDir(pattern)) {
      if (!PermissionRule.broad(rule)) return rule
      return { permission, pattern: ".kilo/**", action: "ask" }
    }
    return rule
  }
}
