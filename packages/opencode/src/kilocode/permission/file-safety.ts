import type { Rule } from "@/kilocode/permission/rule"
import { ConfigProtection } from "@/kilocode/permission/config-paths"
import { ReadPermission } from "@/kilocode/permission/read"

type Config = { dangerously_disable_file_safety_guards?: boolean }
type Request = {
  permission: string
  patterns: readonly string[]
  metadata?: Record<string, unknown>
}

export const FileSafety = {
  enabled(config: Config) {
    return config.dangerously_disable_file_safety_guards !== true
  },

  scope<T extends Config>(config: T, source: "global" | "local"): T {
    if (source === "global" || config.dangerously_disable_file_safety_guards !== true) return config
    const scoped = { ...config }
    delete scoped.dangerously_disable_file_safety_guards
    return scoped
  },

  read(active: boolean) {
    if (!active) return "allow" as const
    return {
      "*": "allow",
      "*.env": "ask",
      "*.env.*": "ask",
      "*.env.example": "allow",
    } as const satisfies Record<string, Rule["action"]>
  },

  harden(active: boolean, permission: string, pattern: string, rule: Rule): Rule {
    return active ? ReadPermission.harden(permission, pattern, rule) : rule
  },

  protected(active: boolean, request: Request) {
    return active && ConfigProtection.isRequest(request)
  },

  skill(active: boolean, request: Request) {
    return active ? ConfigProtection.globalSkillPattern(request) : undefined
  },
}
