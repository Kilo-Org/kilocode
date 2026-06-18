type Command = {
  name: string
  hidden?: boolean
  slashName?: string
  slashAliases?: unknown
}

type Entry = {
  command: Command
}

type Keymap = {
  getCommandEntries(input: {
    visibility: "reachable"
    namespace: "palette"
    filter: (command: Command) => boolean
  }): readonly Entry[]
  dispatchCommand(command: string): unknown
}

type Option = {
  display: string
  aliases?: string[]
}

const palette = "command.palette.show"

function visible(command: Command) {
  return command.hidden !== true && command.name !== palette
}

function parse(input: string) {
  if (!input.startsWith("/")) return
  const line = input.split("\n")[0]
  const name = line.split(" ")[0]?.slice(1)
  if (!name) return
  return name
}

function aliases(command: Command) {
  const list = command.slashAliases
  if (!Array.isArray(list)) return []
  return list.filter((item): item is string => typeof item === "string" && item.length > 0)
}

function match(command: Command, name: string) {
  if (command.slashName === name) return true
  return aliases(command).includes(name)
}

export namespace TuiSlash {
  export function dispatch(keymap: Keymap, input: string) {
    const name = parse(input)
    if (!name) return false
    const entry = keymap
      .getCommandEntries({
        visibility: "reachable",
        namespace: "palette",
        filter: visible,
      })
      .filter((entry) => visible(entry.command))
      .find((entry) => match(entry.command, name))
    if (!entry) return false
    keymap.dispatchCommand(entry.command.name)
    return true
  }

  export function options<T extends Option>(items: readonly T[]) {
    return items.flatMap((item) => [
      item,
      ...(item.aliases ?? []).map((alias) => ({
        ...item,
        display: alias,
        aliases: [item.display, ...(item.aliases ?? []).filter((value) => value !== alias)],
      })),
    ])
  }
}
