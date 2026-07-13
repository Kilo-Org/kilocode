export * as ConfigCommand from "./command"

import path from "path"
import * as Log from "@opencode-ai/core/util/log"
import { Cause, Exit, Schema, SchemaIssue } from "effect"
import { Glob } from "@opencode-ai/core/util/glob"
import { configEntryNameFromPath } from "./entry-name"
import * as ConfigMarkdown from "./markdown"
import { ConfigModelID } from "./model-id"
// kilocode_change start
import { Bus } from "@/bus"
import { NamedError } from "@opencode-ai/core/util/error"
import { KilocodeConfig } from "@/kilocode/config/config"
import type { Warning } from "./config"
import type { ConfigVariable } from "./variable"
// kilocode_change end

const log = Log.create({ service: "config" })

export const Info = Schema.Struct({
  template: Schema.String,
  description: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  model: Schema.optional(ConfigModelID),
  subtask: Schema.optional(Schema.Boolean),
})

export type Info = Schema.Schema.Type<typeof Info>

const decodeInfo = Schema.decodeUnknownExit(Info)

// kilocode_change start
export async function load(
  dir: string,
  warnings?: Warning[],
  trusted = false,
  fileScope?: ConfigVariable.FileScope,
  sourceScope?: ConfigVariable.FileScope,
) {
  // kilocode_change end
  const result: Record<string, Info> = {}
  for (const item of await Glob.scan("{command,commands}/**/*.md", {
    cwd: dir,
    absolute: true,
    dot: true,
    symlink: true,
  })) {
    // kilocode_change start
    const md = await ConfigMarkdown.parse(item, { trusted, fileScope, sourceScope }).catch(async (err) => {
      // kilocode_change end
      const message = ConfigMarkdown.FrontmatterError.isInstance(err)
        ? err.data.message
        : `Failed to parse command ${item}`
      // kilocode_change start
      if (warnings) warnings.push({ path: item, message })
      try {
        const { capture } = await import("@/kilocode/instance")
        const ctx = capture()
        if (ctx) {
          const { Session } = await import("@/session/session")
          await Bus.publish(ctx, Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
        }
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
