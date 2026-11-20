import type { Config } from "@/config/config"
import type { ConfigPermissionV1 } from "@opencode-ai/core/v1/config/permission"

type Rules = { permission?: ConfigPermissionV1.Info; tools?: Readonly<Record<string, boolean>> }
export type Source = Pick<Config.Info, "permission" | "tools" | "agent" | "mode">

export function layers(sources: readonly Source[], agent?: string): readonly ConfigPermissionV1.Info[] {
  return sources.flatMap((source) => {
    const rules = (value?: Rules) => {
      if (!value) return []
      const tools = Object.fromEntries(
        Object.entries(value.tools ?? {}).map(([key, enabled]) => [
          key === "write" || key === "patch" ? "edit" : key,
          enabled ? ("allow" as const) : ("deny" as const),
        ]),
      )
      const layer = { ...tools, ...value.permission }
      return Object.keys(layer).length ? [layer] : []
    }
    return [
      ...rules(source),
      ...(agent && Object.hasOwn(source.agent ?? {}, agent) ? rules(source.agent?.[agent]) : []),
      ...(agent && Object.hasOwn(source.mode ?? {}, agent) ? rules(source.mode?.[agent]) : []),
    ]
  })
}
