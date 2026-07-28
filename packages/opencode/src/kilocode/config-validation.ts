// kilocode_change - new file
import path from "path"
import { type ParseError, parse, printParseErrorCode } from "jsonc-parser"
import { Schema } from "effect"
import { ConfigProtection } from "./permission/config-paths"
import { ConfigMarkdown } from "@/config/markdown"
import { ConfigParse } from "@/config/parse"
import { Config } from "@/config/config"
import { ConfigAgentV1 } from "@opencode-ai/core/v1/config/agent"
import { ConfigCommandV1 } from "@opencode-ai/core/v1/config/command"
import { ConfigErrorV1, FrontmatterError } from "@opencode-ai/core/v1/config/error"
import { Instance } from "@/kilocode/instance"
import { Filesystem } from "@/util/filesystem"

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
    const text = await Filesystem.readText(filepath).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return undefined
      throw new ConfigErrorV1.JsonError({ path: filepath }, { cause: err })
    })
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

    const issues = (() => {
      try {
        ConfigParse.schema(Config.Info, data, filepath)
        return undefined
      } catch (err) {
        if (err instanceof Error) return err.message
        return String(err)
      }
    })()
    if (issues) {
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
      const trusted = path.isAbsolute(filepath) && ConfigProtection.isAbsolute(filepath)
      const ctx = Instance.current
      const root = ctx.worktree === "/" ? ctx.directory : ctx.worktree
      md = await ConfigMarkdown.parse(filepath, {
        trusted,
        fileScope: trusted ? undefined : { root, source: filepath },
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      const msg = FrontmatterError.isInstance(e)
        ? e.data.message
        : `Failed to parse frontmatter: ${e instanceof Error ? e.message : String(e)}`
      return `\n\n<config_validation>\nERROR: ${label(filepath)}\n  ${msg}\n</config_validation>`
    }

    const config =
      schema === "command" ? { ...md.data, template: md.content.trim() } : { ...md.data, prompt: md.content.trim() }

    if (schema === "command") {
      const issues = validateEffectSchema(ConfigCommandV1.Info, config)
      if (issues) {
        return `\n\n<config_validation>\nWARNING: Configuration is invalid at ${label(filepath)}\n${issues}\n</config_validation>`
      }
    } else {
      const issues = validateEffectSchema(ConfigAgentV1.Info, config)
      if (issues) {
        return `\n\n<config_validation>\nWARNING: Configuration is invalid at ${label(filepath)}\n${issues}\n</config_validation>`
      }
    }

    return `\n\n<config_validation>\nConfig file validated successfully.\n</config_validation>`
  }

  function validateEffectSchema<S extends Schema.Decoder<unknown>>(schema: S, input: unknown): string | undefined {
    const std = Schema.toStandardSchemaV1(schema)["~standard"]
    const outcome = std.validate(input)
    // validate may return a Promise only when async rules exist; our schemas are sync.
    if (outcome instanceof Promise) {
      throw new Error("Unexpected async validation in ConfigValidation.validateEffectSchema")
    }
    if (!("issues" in outcome) || !outcome.issues) return undefined
    return outcome.issues
      .map(
        (i) =>
          `  ${(i.path ?? []).map((p) => (typeof p === "object" && p !== null ? p.key : p)).join(".")}: ${i.message}`,
      )
      .join("\n")
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
      const { AppRuntime } = await import("@/effect/app-runtime")
      const warns = await AppRuntime.runPromise(Config.Service.use((svc) => svc.warnings()))
      if (warns.length === 0) return ""
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
