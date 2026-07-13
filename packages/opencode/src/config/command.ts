export * as ConfigCommand from "./command"

import path from "path"
import * as Log from "@opencode-ai/core/util/log"
import { Cause, Exit, Schema } from "effect"
import { SchemaIssue } from "effect" // kilocode_change - preserve Effect issue details in Kilo warnings
import { Glob } from "@opencode-ai/core/util/glob"
import { ConfigCommandV1 } from "@opencode-ai/core/v1/config/command"
import { configEntryNameFromPath } from "./entry-name"
import * as ConfigMarkdown from "./markdown"
// kilocode_change start
import { FrontmatterError } from "@opencode-ai/core/v1/config/error"
import { KilocodeConfig } from "@/kilocode/config/config"
import { report } from "@/kilocode/config/report"
import type { Warning } from "./config"
import type { ConfigVariable } from "./variable"
// kilocode_change end

const log = Log.create({ service: "config" })

const decodeInfo = Schema.decodeUnknownExit(ConfigCommandV1.Info)

// kilocode_change start
export async function load(
  dir: string,
  warnings?: Warning[],
  trusted = false,
  fileScope?: ConfigVariable.FileScope,
  sourceScope?: ConfigVariable.FileScope,
) {
  // kilocode_change end
  const result: Record<string, ConfigCommandV1.Info> = {}
  for (const item of await Glob.scan("{command,commands}/**/*.md", {
    cwd: dir,
    absolute: true,
    dot: true,
    symlink: true,
  })) {
    // kilocode_change start
    const md = await ConfigMarkdown.parse(item, { trusted, fileScope, sourceScope }).catch(async (err) => {
      // kilocode_change end
      const message = FrontmatterError.isInstance(err)
        ? err.data.message
        : `Failed to parse command ${item}`
      // kilocode_change start
      if (warnings) warnings.push({ path: item, message })
      try {
        const { capture } = await import("@/kilocode/instance")
        const ctx = capture()
        if (ctx) await report(ctx, message)
      } catch (error) {
        log.warn("could not publish session error", { message, err: error })
      }
      // kilocode_change end
      log.error("failed to load command", { command: item, err })
      return undefined
    })
    if (!md) continue

    const name = configEntryNameFromPath(path.relative(dir, item), ["command/", "commands/"])

    const config = {
      name,
      ...md.data,
      template: md.content.trim(),
    }
    const parsed = decodeInfo(config, { errors: "all", propertyOrder: "original" })
    if (Exit.isSuccess(parsed)) {
      result[config.name] = parsed.value
      continue
    }
    // kilocode_change start
    const error = Cause.squash(parsed.cause)
    const issues = Schema.isSchemaError(error)
      ? SchemaIssue.makeFormatterStandardSchemaV1()(error.issue).issues.map((issue) => ({
          ...issue,
          message: issue.message,
          path: issue.path?.map(String) ?? [],
        }))
      : [{ message: String(error), path: [] }]
    const cause = error instanceof Error ? error : new Error(String(error))
    await KilocodeConfig.handleInvalid("command", item, issues, cause, warnings)
    // kilocode_change end
  }
  return result
}
