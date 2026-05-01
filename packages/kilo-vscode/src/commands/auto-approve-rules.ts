type Action = "allow" | "ask" | "deny"
type Value = Action | null | Record<string, Action | null>

export type Config = Partial<Record<string, Value>>

type Rule = {
  permission: string
  pattern: string
  action: Action
}

export function shouldAutoApprove(input: { permission: string; patterns: readonly string[]; config?: Config }): boolean {
  const patterns = input.patterns.length > 0 ? input.patterns : ["*"]
  return patterns.every((pattern) => action(input.config, input.permission, pattern) !== "ask")
}

function action(config: Config | undefined, permission: string, pattern: string): Action | undefined {
  const list = rules(config)
  for (const rule of [...list].reverse()) {
    if (glob(rule.permission, permission) && glob(rule.pattern, pattern)) return rule.action
  }
}

function rules(config: Config | undefined): Rule[] {
  if (!config) return []

  return Object.entries(config)
    .sort(([a], [b]) => {
      const aw = a.includes("*")
      const bw = b.includes("*")
      return aw === bw ? 0 : aw ? -1 : 1
    })
    .flatMap(([permission, value]) => {
      if (typeof value === "string") return [{ permission, pattern: "*", action: value }]
      if (!value) return []

      return Object.entries(value)
        .filter((entry): entry is [string, Action] => entry[1] !== null)
        .map(([pattern, action]) => ({ permission, pattern, action }))
    })
}

function glob(pattern: string, value: string): boolean {
  if (pattern === "*") return true
  const source = pattern.replace(/[|\\{}()[\]^$+?.]/g, "\\$&").replace(/\*/g, ".*")
  return new RegExp(`^${source}$`).test(value)
}
