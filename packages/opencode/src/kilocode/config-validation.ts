// kilocode_change - new file
import path from "path"
import { type ParseError, parse, printParseErrorCode } from "jsonc-parser"
import { ConfigProtection } from "./permission/config-paths"
import { ConfigMarkdown } from "@/config"
import { Config } from "@/config"
import { ConfigAgent } from "@/config"
import { ConfigCommand } from "@/config"
import { ConfigPaths } from "@/config/paths"
import { Instance } from "@/project/instance"

export namespace ConfigValidation {
  const JSONC_EXT = new Set([".json", ".jsonc"])
  const COMMAND_DIRS = new Set(["command", "commands"])
  const AGENT_DIRS = new Set(["agent", "agents"])
  const MODE_DIRS = new Set(["mode", "modes"])

  function label(filepath: string): string {
    const rel = path.isAbsolute(filepath) ? filepath.replace(process.env.HOME || "~", "~") : filepath
    return rel
  }

  async function jsonc(filepath: string): Promise<string> {
    const text = await ConfigPaths.readFile(filepath)
    if (text === undefined) return ""

    const errors: ParseError[] = []
    const data = parse(text, errors, { allowTrailingComma: true })

    if (errors.length > 0) {
      const lines = text.split("\n")
      const detail = errors
        .map((e) => {
          const before = text.substring(0, e.offset).split("\n")
          const line = before.length
          const col = before[before.length - 1].length + 1
          const src = lines[line - 1]
          const msg = `${printParseErrorCode(e.error)} at line ${line}, column ${col}`
          return src ? `${msg}\n   Line ${line}: ${src}` : msg
        })
        .join("\n")
      return `\n\n<config_validation>\nERROR: Config file at ${label(filepath)} is not valid JSON(C)\n  ${detail}\n</config_validation>`
    }

    const result = Config.Info.safeParse(data)
    if (!result.success) {
      const issues = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")
      return `\n\n<config_validation>\nWARNING: Configuration is invalid at ${label(filepath)}\n${issues}\n</config_validation>`
    }

    return `\n\n<config_validation>\nConfig file validated successfully.\n</config_validation>`
  }

  async function markdown(filepath: string): Promise<string> {
    const dir = path.basename(path.dirname(filepath))

    // Determine schema from parent directory
    const schema = COMMAND_DIRS.has(dir) ? "command" : AGENT_DIRS.has(dir) || MODE_DIRS.has(dir) ? "agent" : undefined
    if (!schema) return ""

    let md: Awaited<ReturnType<typeof ConfigMarkdown.parse>>
    try {
      md = await ConfigMarkdown.parse(filepath)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      const msg = ConfigMarkdown.FrontmatterError.isInstance(e)
        ? e.data.message
        : `Failed to parse frontmatter: ${e instanceof Error ? e.message : String(e)}`
      return `\n\n<config_validation>\nERROR: ${label(filepath)}\n  ${msg}\n</config_validation>`
    }

    const config =
      schema === "command" ? { ...md.data, template: md.content.trim() } : { ...md.data, prompt: md.content.trim() }

    const zod = schema === "command" ? ConfigCommand.Info : ConfigAgent.Info
    const result = zod.safeParse(config)
    if (!result.success) {
      const issues = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")
      return `\n\n<config_validation>\nWARNING: Configuration is invalid at ${label(filepath)}\n${issues}\n</config_validation>`
    }

    return `\n\n<config_validation>\nConfig file validated successfully.\n</config_validation>`
  }

  function isConfig(filepath: string): boolean {
    if (!path.isAbsolute(filepath)) return ConfigProtection.isRelative(filepath)
    // Global config dirs (e.g. ~/.config/kilo/)
    if (ConfigProtection.isAbsolute(filepath)) return true
    // Project-local config (e.g. /project/.kilo/command/foo.md)
    try {
      const rel = path.relative(Instance.worktree, filepath)
      if (!rel.startsWith("..")) return ConfigProtection.isRelative(rel)
    } catch {
      // Not in an Instance context — skip project-relative check
    }
    return false
  }

  async function existing(): Promise<string> {
    try {
      const warns = await Config.warnings()
      if (!warns || warns.length === 0) return ""
      const items = warns.map((w: Config.Warning) => `  ${label(w.path)}: ${w.message}`).join("\n")
      return `Pre-existing config issues (from session start):\n${items}\n\n`
    } catch {
      return ""
    }
  }

  /**
   * Validate a file if it's a config file. Returns formatted output to append
   * to tool results, or empty string for non-config files.
   */
  export async function check(filepath: string): Promise<string> {
    if (!isConfig(filepath)) return ""

    const ext = path.extname(filepath).toLowerCase()

    // Skip AGENTS.md and other root .md files not in a recognized config subdir
    if (ext === ".md") {
      const dir = path.basename(path.dirname(filepath))
      if (!COMMAND_DIRS.has(dir) && !AGENT_DIRS.has(dir) && !MODE_DIRS.has(dir)) {
        return ""
      }
    }

    const prefix = await existing()

    const validation = JSONC_EXT.has(ext) ? await jsonc(filepath) : ext === ".md" ? await markdown(filepath) : ""

    if (!validation) return ""

    if (prefix) {
      // Replace the opening tag content with prefixed version
      return validation.replace(
        "<config_validation>\n",
        `<config_validation>\n${prefix}Post-edit validation of ${label(filepath)}:\n`,
      )
    }

    return validation
  }
}
