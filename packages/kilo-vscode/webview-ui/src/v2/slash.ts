// The slash command menu of the v2 composer: one catalog of client actions, server commands and skills, and the
// matching, ordering and lookup over it. Kept free of JSX and webview contexts, so the extension tests can load it.
import type { CommandInfo, SkillInfo } from "@opencode/client"

export type SlashEntry = {
  /** What the user types after the slash. A nested entry names its parent first, for example "review staged". */
  name: string
  description?: string
  /** Other words that find the entry, for example "clear" for /new. */
  hints: string[]
} & (
  | { kind: "action"; run: () => void }
  /** `args` leads the text of a nested entry, for example "staged" for /review staged. */
  | { kind: "command"; command: CommandInfo; args?: string }
  | { kind: "skill"; skill: SkillInfo }
)

/**
 * Merges the catalog in menu group order: client actions, server commands, then skills. A client action hides a
 * server command of the same name. A skill whose name is taken gets the suffix `:skill`, so both rows stay
 * reachable. A nested entry needs its parent, so the children of a missing command are dropped.
 */
export function mergeCatalog(input: {
  actions: SlashEntry[]
  commands: readonly CommandInfo[]
  /** Nested entries of server commands, listed after their parents. */
  nested?: SlashEntry[]
  skills: readonly SkillInfo[]
}): SlashEntry[] {
  const taken = new Set(input.actions.map((entry) => entry.name))
  const commands = input.commands
    .filter((command) => !taken.has(command.name))
    .map((command): SlashEntry => {
      taken.add(command.name)
      return { kind: "command", name: command.name, description: command.description, hints: [], command }
    })
  const seen = new Set<string>()
  const skills = input.skills.flatMap((skill): SlashEntry[] => {
    if (seen.has(skill.name)) return []
    seen.add(skill.name)
    const name = free(taken, skill.name)
    taken.add(name)
    return [{ kind: "skill", name, description: skill.description, hints: [], skill }]
  })
  const all = [...input.actions, ...commands, ...(input.nested ?? []), ...skills]
  const roots = new Set(all.filter((entry) => !nested(entry)).map((entry) => entry.name))
  return all.filter((entry) => !nested(entry) || roots.has(parent(entry.name)))
}

/** The entries of the menu for a query, in group order and by match quality within each group. */
export function matchSlash(entries: readonly SlashEntry[], query: string): SlashEntry[] {
  const lower = query.toLowerCase()
  const space = lower.indexOf(" ")
  if (space !== -1) {
    // A nested query matches the children of its command on the words after the command, hints included.
    const head = lower.slice(0, space)
    const rest = lower.slice(space + 1).trimStart()
    const children = entries.filter((entry) => nested(entry) && parent(entry.name).toLowerCase() === head)
    if (!rest) return group(children)
    return group(
      rank(
        children.filter((entry) => score(entry, rest) > 0),
        rest,
      ),
    )
  }
  const roots = entries.filter((entry) => !nested(entry))
  if (!lower) return group(roots)
  return group(
    rank(
      roots.filter((entry) => score(entry, lower) > 0),
      lower,
    ),
  )
}

/**
 * The menu query for the text before the cursor, or undefined when the menu stays closed. A slash at the start
 * opens the root list; a root command followed by a space opens its nested entries while one of them still matches.
 */
export function slashQuery(entries: readonly SlashEntry[], before: string): string | undefined {
  const root = before.match(/^\/(\S*)$/)
  if (root) return root[1]
  const child = before.match(/^\/(\S+)[ \t]+([^\n]*)$/)
  if (!child) return
  const value = `${child[1]} ${child[2]}`.toLowerCase()
  if (matchSlash(entries, value).length === 0) return
  return value
}

/**
 * The entry a sent draft names, with the text after the command word as its arguments. An exact name wins over an
 * action hint, so a server command is never taken by a client alias.
 */
export function parseSlash(entries: readonly SlashEntry[], text: string) {
  const match = text.match(/^\/(\S+)/)
  if (!match) return
  const word = match[1]
  const roots = entries.filter((entry) => !nested(entry))
  const entry =
    roots.find((item) => item.name === word) ??
    roots.find((item) => item.kind === "action" && item.hints.includes(word))
  if (!entry) return
  return { entry, args: text.slice(match[0].length).trim() }
}

/** True when the entry opens a list of nested entries instead of running. */
export function hasChildren(entries: readonly SlashEntry[], entry: SlashEntry) {
  return !nested(entry) && entries.some((item) => nested(item) && parent(item.name) === entry.name)
}

function nested(entry: SlashEntry) {
  return entry.name.includes(" ")
}

function parent(name: string) {
  return name.slice(0, name.indexOf(" "))
}

// A skill whose name is taken gets `:skill`, then a number when that is taken too, so every row stays reachable.
function free(taken: ReadonlySet<string>, name: string) {
  if (!taken.has(name)) return name
  const base = `${name}:skill`
  if (!taken.has(base)) return base
  const index = Array.from({ length: taken.size }, (_, item) => item + 2).find((item) => !taken.has(`${base}${item}`))
  return `${base}${index}`
}

// Scores the name a query is typed against: the whole name of a root entry, the words after the command of a child.
function score(entry: SlashEntry, lower: string) {
  const name = (nested(entry) ? entry.name.slice(entry.name.indexOf(" ") + 1) : entry.name).toLowerCase()
  if (name === lower) return 3
  if (name.startsWith(lower)) return 2
  if (name.includes(lower)) return 1
  // A child's description is not matched: free review guidance after the command would select a scope on Enter.
  if (!nested(entry) && entry.description?.toLowerCase().includes(lower)) return 1
  if (entry.hints.some((hint) => hint.toLowerCase().includes(lower))) return 1
  return 0
}

function rank(entries: SlashEntry[], lower: string) {
  return entries.toSorted((a, b) => score(b, lower) - score(a, lower))
}

// The menu renders contiguous Actions, Commands and Skills groups, so the keyboard index follows the same order.
function group(entries: SlashEntry[]) {
  return [
    ...entries.filter((entry) => entry.kind === "action"),
    ...entries.filter((entry) => entry.kind === "command"),
    ...entries.filter((entry) => entry.kind === "skill"),
  ]
}
