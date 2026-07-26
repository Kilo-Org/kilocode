import type { Rule } from "@/kilocode/permission/rule"

type Config = { dangerously_disable_file_safety_guards?: boolean }

export namespace FileSafety {
  export function enabled(config: Config) {
    return config.dangerously_disable_file_safety_guards !== true
  }

  export function scope<T extends Config>(config: T, source: "global" | "local"): T {
    if (source === "global" || config.dangerously_disable_file_safety_guards !== true) return config
    const scoped = { ...config }
    delete scoped.dangerously_disable_file_safety_guards
    return scoped
  }

  export function read(active: boolean) {
    if (!active) return "allow" as const
    return {
      "*": "allow",
      "*.env": "ask",
      "*.env.*": "ask",
      "*.env.example": "allow",
    } as const satisfies Record<string, Rule["action"]>
  }
}
