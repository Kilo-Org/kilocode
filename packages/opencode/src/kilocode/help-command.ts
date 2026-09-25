import { cmd } from "../cli/cmd/cmd"
import { generateHelp } from "./help"
import type { Argv } from "yargs"
import { markLazyCommandSelection } from "@/kilocode/cli/lazy-commands"

// A nested command may arrive either as one quoted argument
// (`kilo help "session list"`) or as separate tokens (`kilo help session list`).
// Normalize both shapes to the space-joined path generateHelp expects.
export function commandPath(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    const joined = value.map(String).join(" ").trim()
    return joined || undefined
  }
  if (typeof value === "string") return value
  return undefined
}

export function createHelpCommand(root?: () => Argv) {
  return cmd({
    command: "help [command..]",
    describe: "show full CLI reference",
    builder: (yargs) => {
      markLazyCommandSelection()
      return yargs
        .positional("command", {
          describe: "command to show help for",
          type: "string",
        })
        .option("all", {
          describe: "show help for all commands",
          type: "boolean",
          default: false,
        })
        .option("format", {
          describe: "output format",
          type: "string",
          choices: ["md", "text"] as const,
          default: "md" as const,
        })
    },
    async handler(args) {
      const command = commandPath(args.command)
      if (!command && !args.all) {
        if (root) {
          const help = await root().getHelp()
          process.stdout.write(help + "\n")
        }
        return
      }
      const output = await generateHelp({
        command,
        all: args.all,
        format: args.format as "md" | "text",
      })
      process.stdout.write(output + "\n")
    },
  })
}

// Static instance for introspection by commands.ts / help.ts (handler not invoked)
export const HelpCommand = createHelpCommand()
