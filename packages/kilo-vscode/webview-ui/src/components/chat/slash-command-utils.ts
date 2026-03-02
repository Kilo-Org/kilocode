import type { CommandInfo } from "../../types/messages"

export function parseSlashQuery(value: string) {
  return value.match(/^\/(\S*)$/)?.[1]
}

export function filterSlashCommands(commands: CommandInfo[], query: string | null) {
  const map = new Map<string, CommandInfo>()
  for (const item of commands) {
    if (!map.has(item.name)) {
      map.set(item.name, item)
    }
  }

  const all = [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  const value = (query ?? "").trim().toLowerCase()
  if (!value) return all
  return all.filter((item) => {
    const name = item.name.toLowerCase()
    const description = item.description?.toLowerCase() ?? ""
    return name.includes(value) || description.includes(value)
  })
}
