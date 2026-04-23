export * as ConfigCommand from "./command"

import { Log } from "../util"
import z from "zod"
import { NamedError } from "@opencode-ai/shared/util/error"
import { Glob } from "@opencode-ai/shared/util/glob"
import { Bus } from "@/bus"
import { configEntryNameFromPath } from "./entry-name"
import * as ConfigMarkdown from "./markdown"
import { ConfigModelID } from "./model-id"
// kilocode_change start
import { KilocodeConfig } from "@/kilocode/config/config"
import type { Warning } from "./config"
// kilocode_change end

const log = Log.create({ service: "config" })

export const Info = z.object({
  template: z.string(),
  description: z.string().optional(),
  agent: z.string().optional(),
  model: ConfigModelID.optional(),
  subtask: z.boolean().optional(),
})

export type Info = z.infer<typeof Info>

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
        const { Session } = await import("@/session")
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
    const parsed = Info.safeParse(config)
    if (parsed.success) {
      result[config.name] = parsed.data
      continue
    }
    // kilocode_change start
    await KilocodeConfig.handleInvalid("command", item, parsed.error.issues, parsed.error, warnings)
    // kilocode_change end
  }
  return result
}
