export * as ConfigAgent from "./agent"

import { Log } from "../util"
import z from "zod"
import { NamedError } from "@opencode-ai/shared/util/error"
import { Glob } from "@opencode-ai/shared/util/glob"
import { Bus } from "@/bus"
import { configEntryNameFromPath } from "./entry-name"
import * as ConfigMarkdown from "./markdown"
import { ConfigModelID } from "./model-id"
import { ConfigPermission } from "./permission"
// kilocode_change start
import { KilocodeConfig } from "@/kilocode/config/config"
import type { Warning } from "./config"
// kilocode_change end

const log = Log.create({ service: "config" })

export const Info = z
  .object({
    model: ConfigModelID.nullable().optional(), // kilocode_change - nullable for delete sentinel
    variant: z
      .string()
      .optional()
      .describe("Default model variant for this agent (applies only when using the agent's configured model)."),
    temperature: z.number().optional(),
    top_p: z.number().optional(),
    prompt: z.string().optional(),
    tools: z.record(z.string(), z.boolean()).optional().describe("@deprecated Use 'permission' field instead"),
    disable: z.boolean().optional(),
    description: z.string().optional().describe("Description of when to use the agent"),
    mode: z.enum(["subagent", "primary", "all"]).optional(),
    hidden: z
      .boolean()
      .optional()
      .describe("Hide this subagent from the @ autocomplete menu (default: false, only applies to mode: subagent)"),
    options: z.record(z.string(), z.any()).optional(),
    color: z
      .union([
        z.string().regex(/^#[0-9a-fA-F]{6}$/, "Invalid hex color format"),
        z.enum(["primary", "secondary", "accent", "success", "warning", "error", "info"]),
      ])
      .optional()
      .describe("Hex color code (e.g., #FF5733) or theme color (e.g., primary)"),
    steps: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Maximum number of agentic iterations before forcing text-only response"),
    maxSteps: z.number().int().positive().optional().describe("@deprecated Use 'steps' field instead."),
    permission: ConfigPermission.Info.optional(),
  })
  .catchall(z.any())
  .transform((agent, _ctx) => {
    const knownKeys = new Set([
      "name",
      "model",
      "variant",
      "prompt",
      "description",
      "temperature",
      "top_p",
      "mode",
      "hidden",
      "color",
      "steps",
      "maxSteps",
      "options",
      "permission",
      "disable",
      "tools",
    ])

    const options: Record<string, unknown> = { ...agent.options }
    for (const [key, value] of Object.entries(agent)) {
      if (!knownKeys.has(key)) options[key] = value
    }

    const permission: ConfigPermission.Info = {}
    for (const [tool, enabled] of Object.entries(agent.tools ?? {})) {
      const action = enabled ? "allow" : "deny"
      if (tool === "write" || tool === "edit" || tool === "patch" || tool === "multiedit") {
        permission.edit = action
        continue
      }
      permission[tool] = action
    }
    Object.assign(permission, agent.permission)

    const steps = agent.steps ?? agent.maxSteps

    return { ...agent, options, permission, steps } as typeof agent & {
      options?: Record<string, unknown>
      permission?: ConfigPermission.Info
      steps?: number
    }
  })
  .meta({
    ref: "AgentConfig",
  })
export type Info = z.infer<typeof Info>

// kilocode_change start
export async function load(dir: string, warnings?: Warning[]) {
  // kilocode_change end
  const result: Record<string, Info> = {}
  for (const item of await Glob.scan("{agent,agents}/**/*.md", {
    cwd: dir,
    absolute: true,
    dot: true,
    symlink: true,
  })) {
    const md = await ConfigMarkdown.parse(item).catch(async (err) => {
      const message = ConfigMarkdown.FrontmatterError.isInstance(err)
        ? err.data.message
        : `Failed to parse agent ${item}`
      // kilocode_change start
      if (warnings) warnings.push({ path: item, message })
      try {
        const { Session } = await import("@/session")
        Bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
      } catch (e) {
        log.warn("could not publish session error", { message, err: e })
      }
      log.error("failed to load agent", { agent: item, err })
      return undefined
      // kilocode_change end
    })
    if (!md) continue

    // kilocode_change start
    const patterns = [
      "/.kilo/agent/",
      "/.kilo/agents/",
      "/.kilocode/agent/",
      "/.kilocode/agents/",
      "/.opencode/agent/",
      "/.opencode/agents/",
      "/agent/",
      "/agents/",
    ]
    // kilocode_change end
    const name = configEntryNameFromPath(item, patterns)

    const config = {
      name,
      ...md.data,
      prompt: md.content.trim(),
    }
    const parsed = Info.safeParse(config)
    if (parsed.success) {
      result[config.name] = parsed.data
      continue
    }
    // kilocode_change start
    await KilocodeConfig.handleInvalid("agent", item, parsed.error.issues, parsed.error, warnings)
    // kilocode_change end
  }
  return result
}

// kilocode_change start
export async function loadMode(dir: string, warnings?: Warning[]) {
  // kilocode_change end
  const result: Record<string, Info> = {}
  for (const item of await Glob.scan("{mode,modes}/*.md", {
    cwd: dir,
    absolute: true,
    dot: true,
    symlink: true,
  })) {
    const md = await ConfigMarkdown.parse(item).catch(async (err) => {
      const message = ConfigMarkdown.FrontmatterError.isInstance(err)
        ? err.data.message
        : `Failed to parse mode ${item}`
      // kilocode_change start
      if (warnings) warnings.push({ path: item, message })
      try {
        const { Session } = await import("@/session")
        Bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
      } catch (e) {
        log.warn("could not publish session error", { message, err: e })
      }
      log.error("failed to load mode", { mode: item, err })
      return undefined
      // kilocode_change end
    })
    if (!md) continue

    const config = {
      name: configEntryNameFromPath(item, []),
      ...md.data,
      prompt: md.content.trim(),
    }
    const parsed = Info.safeParse(config)
    if (parsed.success) {
      result[config.name] = {
        ...parsed.data,
        mode: "primary" as const,
      }
      continue
    }
    // kilocode_change start
    await KilocodeConfig.handleInvalid("agent", item, parsed.error.issues, parsed.error, warnings)
    // kilocode_change end
  }
  return result
}
