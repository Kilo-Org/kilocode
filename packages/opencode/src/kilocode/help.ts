import yargs from "yargs"
import type { CommandModule } from "yargs"

type Cmd = CommandModule<any, any>

const ANSI_REGEX = /\x1b\[[0-9;]*m/g

function strip(text: string): string {
  return text.replace(ANSI_REGEX, "")
}

function extractCommandName(cmd: Cmd): string | undefined {
  const raw = typeof cmd.command === "string" ? cmd.command : cmd.command?.[0]
  if (!raw) return undefined
  if (raw.startsWith("$0")) return undefined
  return raw.split(/[\s[<]/)[0]
}

async function getHelpText(name: string, cmd: Cmd): Promise<string> {
  const inst = yargs([]).scriptName(`kilo ${name}`).wrap(null)
  if (cmd.builder) {
    if (typeof cmd.builder === "function") {
      ;(cmd.builder as any)(inst)
    } else {
      inst.options(cmd.builder as any)
    }
  }
  if (cmd.describe) {
    inst.usage(typeof cmd.describe === "string" ? cmd.describe : "")
  }
  const help = await inst.getHelp()
  return strip(help)
}

async function getSubcommands(name: string, cmd: Cmd): Promise<Array<{ name: string; hidden: boolean; help: string }>> {
  if (!cmd.builder || typeof cmd.builder !== "function") return []

  const inst = yargs([]).scriptName(`kilo ${name}`).wrap(null)
  ;(cmd.builder as any)(inst)

  const result: Array<{ name: string; hidden: boolean; help: string }> = []

  try {
    const internal = (inst as any).getInternalMethods()
    const cmdInstance = internal.getCommandInstance()
    const handlers = cmdInstance.getCommandHandlers()

    for (const [sub, handler] of Object.entries(handlers as Record<string, any>)) {
      if (sub === "$0") continue

      const full = `${name} ${sub}`
      const subInst = yargs([]).scriptName(`kilo ${full}`).wrap(null)

      if (handler.builder && typeof handler.builder === "function") {
        handler.builder(subInst)
      } else if (handler.builder && typeof handler.builder === "object") {
        subInst.options(handler.builder)
      }

      if (handler.description) {
        subInst.usage(handler.description)
      }

      const help = strip(await subInst.getHelp())
      result.push({
        name: full,
        hidden: handler.description === false,
        help,
      })
    }
  } catch (err) {
    // yargs internals unavailable
  }

  return result
}

function formatMarkdown(
  sections: Array<{
    name: string
    hidden: boolean
    help: string
    subs: Array<{ name: string; hidden: boolean; help: string }>
  }>,
): string {
  const parts: string[] = []

  for (const section of sections) {
    parts.push(`## kilo ${section.name}`)
    parts.push("")
    if (section.hidden) {
      parts.push("> **Internal command** — not intended for direct use.")
      parts.push("")
    }
    parts.push("```")
    parts.push(section.help)
    parts.push("```")
    parts.push("")

    for (const sub of section.subs) {
      parts.push(`### kilo ${sub.name}`)
      parts.push("")
      if (sub.hidden) {
        parts.push("> **Internal command** — not intended for direct use.")
        parts.push("")
      }
      parts.push("```")
      parts.push(sub.help)
      parts.push("```")
      parts.push("")
    }
  }

  return parts.join("\n")
}

function formatText(
  sections: Array<{
    name: string
    hidden: boolean
    help: string
    subs: Array<{ name: string; hidden: boolean; help: string }>
  }>,
): string {
  const parts: string[] = []
  const rule = "=".repeat(80)

  for (const section of sections) {
    parts.push(rule)
    const label = section.hidden ? `kilo ${section.name} [internal]` : `kilo ${section.name}`
    parts.push(label)
    parts.push(rule)
    parts.push("")
    parts.push(section.help)
    parts.push("")

    for (const sub of section.subs) {
      const sublabel = sub.hidden ? `--- kilo ${sub.name} [internal] ---` : `--- kilo ${sub.name} ---`
      parts.push(sublabel)
      parts.push("")
      parts.push(sub.help)
      parts.push("")
    }
  }

  return parts.join("\n")
}

async function loadCommands(): Promise<Cmd[]> {
  const { commands } = await import("../cli/commands")
  return commands as Cmd[]
}

export async function generateHelp(options: {
  command?: string
  all?: boolean
  format?: "md" | "text"
  commands?: Cmd[]
}): Promise<string> {
  const format = options.format ?? "md"

  const all = options.commands ?? (await loadCommands())
  const relevant = options.command
    ? all.filter((c) => extractCommandName(c) === options.command)
    : all.filter((c) => extractCommandName(c) !== undefined)

  if (options.command && relevant.length === 0) {
    throw new Error(`unknown command: ${options.command}`)
  }

  const sections: Array<{
    name: string
    hidden: boolean
    help: string
    subs: Array<{ name: string; hidden: boolean; help: string }>
  }> = []

  for (const cmd of relevant) {
    const name = extractCommandName(cmd)!
    const help = await getHelpText(name, cmd)
    const hidden = (cmd as any).hidden === true
    const subs = await getSubcommands(name, cmd)

    sections.push({ name, hidden, help, subs })
  }

  return format === "md" ? formatMarkdown(sections) : formatText(sections)
}
