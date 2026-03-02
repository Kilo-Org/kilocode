import { cmd } from "../cli/cmd/cmd"
import { generateHelp } from "./help"

export const HelpCommand = cmd({
  command: "help [command]",
  describe: "show full CLI reference",
  builder: (yargs) =>
    yargs
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
      }),
  async handler(args) {
    if (!args.command && !args.all) {
      process.stdout.write("Usage: kilo help --all           Show full CLI reference\n")
      process.stdout.write("       kilo help <command>       Show help for a specific command\n")
      return
    }
    const output = await generateHelp({
      command: args.command,
      all: args.all,
      format: args.format as "md" | "text",
    })
    process.stdout.write(output + "\n")
  },
})
