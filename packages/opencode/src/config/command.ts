export * as ConfigCommand from "./command"

import * as Log from "@opencode-ai/core/util/log"
import { Cause, Exit, Schema, SchemaIssue } from "effect"
import { NamedError } from "@opencode-ai/core/util/error"
import { Glob } from "@opencode-ai/core/util/glob"
import { Bus } from "@/bus"
import { configEntryNameFromPath } from "./entry-name"
import * as ConfigMarkdown from "./markdown"
import { ConfigModelID } from "./model-id"
// kilocode_change start
import { KilocodeConfig } from "@/kilocode/config/config"
import type { Warning } from "./config"
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
export async function load(dir: string, warnings?: Warning[]) {
  // kilocode_change end
  const result: Record<string, Info> = {}
  for (const item of await Glob.scan("{command,commands}/**/*.md", {
    cwd: dir,
    absolute: true,
    dot: true,
    symlink: true,
  })) {
    const md = await ConfigMarkdown.parse(item).catch(async (err) => {
      const message = ConfigMarkdown.FrontmatterError.isInstance(err)
        ? err.data.message
        : `Failed to parse command ${item}`
      // kilocode_change start
      if (warnings) warnings.push({ path: item, message })
      try {
        const { Session } = await import("@/session/session")
        Bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
      } catch (e) {
        log.warn("could not publish session error", { message, err: e })
      }
      log.error("failed to load command", { command: item, err })
      return undefined
      // kilocode_change end
    })
    if (!md) continue

    // kilocode_change start
    const patterns = [
      "/.kilo/command/",
      "/.kilo/commands/",
      "/.kilocode/command/",
      "/.kilocode/commands/",
      "/.opencode/command/",
      "/.opencode/commands/",
      "/command/",
      "/commands/",
    ]
    // kilocode_change end
    const name = configEntryNameFromPath(item, patterns)

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
