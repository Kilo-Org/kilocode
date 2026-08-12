import { readFile, unlink } from "node:fs/promises"
import path from "node:path"
import { Global } from "@opencode-ai/core/global"
import { Glob } from "@opencode-ai/core/util/glob"
import { Schema } from "effect"
import { Command } from "@/command"
import { configEntryNameFromPath } from "@/config/entry-name"
import { WorkflowsMigrator } from "@/kilocode/workflows-migrator"

export const Info = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  variant: Schema.optional(Schema.String),
  source: Schema.optional(Schema.String),
  builtin: Schema.Boolean,
  location: Schema.String,
  editable: Schema.Boolean,
  content: Schema.optional(Schema.String),
  subtask: Schema.optional(Schema.Boolean),
  hints: Schema.Array(Schema.String),
}).annotate({ identifier: "CommandFile" })

export type Info = Schema.Schema.Type<typeof Info>

type File = {
  name: string
  location: string
  content: string
}

const COMMAND_PREFIXES = ["command/", "commands/"]

async function files(dir: string) {
  const result: File[] = []
  for (const file of await Glob.scan("{command,commands}/**/*.md", { cwd: dir, absolute: true, dot: true, symlink: true })) {
    result.push(await command(dir, file))
  }
  return result
}

async function command(dir: string, file: string): Promise<File> {
  const content = await readFile(file, "utf8")
  return {
    name: configEntryNameFromPath(path.relative(dir, file), COMMAND_PREFIXES),
    location: file,
    content,
  }
}

function precedence(files: File[]) {
  const result = new Map<string, File>()
  for (const file of files) result.set(file.name, file)
  return result
}

function description(cmd: Command.Info, file?: File) {
  if (cmd.description) return cmd.description
  if (file) return WorkflowsMigrator.extractDescription(file.content)
  return undefined
}

function literal(cmd: Command.Info) {
  return typeof cmd.template === "string" ? cmd.template : undefined
}

export async function discover(input: { commands: readonly Command.Info[]; directories: readonly string[]; directory: string }) {
  const all = []
  for (const item of await WorkflowsMigrator.discoverWorkflows(input.directory)) {
    all.push({ name: item.name, location: item.path, content: item.content })
  }
  for (const dir of input.directories) all.push(...(await files(dir)))
  const by = precedence(all)
  return input.commands
    .filter((cmd) => cmd.source !== "skill")
    .map((cmd): Info => {
      const file = by.get(cmd.name)
      if (file) {
        return {
          name: cmd.name,
          description: description(cmd, file),
          agent: cmd.agent,
          model: cmd.model,
          variant: cmd.variant,
          source: cmd.source,
          builtin: false,
          location: file.location,
          editable: true,
          content: file.content,
          subtask: cmd.subtask,
          hints: cmd.hints,
        }
      }
      return {
        name: cmd.name,
        description: description(cmd),
        agent: cmd.agent,
        model: cmd.model,
        variant: cmd.variant,
        source: cmd.source,
        builtin: true,
        location: "builtin",
        editable: false,
        content: literal(cmd),
        subtask: cmd.subtask,
        hints: cmd.hints,
      }
    })
}

export function target(location: string, commands: readonly Info[]) {
  if (!path.isAbsolute(location)) throw new Error("command location must be absolute")
  const file = path.resolve(location)
  const command = commands.find((item) => item.editable && path.resolve(item.location) === file)
  if (!command) throw new Error("command not found in registry")
  if (!file.endsWith(".md")) throw new Error("command location must reference a markdown file")
  const cache = path.join(Global.Path.cache, "commands")
  const relative = path.relative(cache, file)
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Error("remove cache-backed commands from configuration")
  }
  return file
}

export async function remove(location: string, commands: readonly Info[]) {
  await unlink(target(location, commands))
}

export * as CommandFiles from "./command-files"
