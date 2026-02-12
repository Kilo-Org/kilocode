import { BusEvent } from "@/bus/bus-event"
import z from "zod"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { Identifier } from "../id/id"
import PROMPT_INITIALIZE from "./template/initialize.txt"
import { MCP } from "../mcp"
import { Skill } from "../skill"
import { localReviewCommand, localReviewUncommittedCommand } from "@/kilocode/review/command" // kilocode_change

export namespace Command {
  export const Event = {
    Executed: BusEvent.define(
      "command.executed",
      z.object({
        name: z.string(),
        sessionID: Identifier.schema("session"),
        arguments: z.string(),
        messageID: Identifier.schema("message"),
      }),
    ),
  }

  export const Info = z
    .object({
      name: z.string(),
      description: z.string().optional(),
      agent: z.string().optional(),
      model: z.string().optional(),
      source: z.enum(["command", "mcp", "skill"]).optional(),
      // workaround for zod not supporting async functions natively so we use getters
      // https://zod.dev/v4/changelog?id=zfunction
      template: z.promise(z.string()).or(z.string()),
      subtask: z.boolean().optional(),
      hidden: z.boolean().optional(), // kilocode_change
      hints: z.array(z.string()),
    })
    .meta({
      ref: "Command",
    })

  // for some reason zod is inferring `string` for z.promise(z.string()).or(z.string()) so we have to manually override it
  export type Info = Omit<z.infer<typeof Info>, "template"> & { template: Promise<string> | string }

  export function hints(template: string): string[] {
    const result: string[] = []
    const numbered = template.match(/\$\d+/g)
    if (numbered) {
      for (const match of [...new Set(numbered)].sort()) result.push(match)
    }
    if (template.includes("$ARGUMENTS")) result.push("$ARGUMENTS")
    return result
  }

  export const Default = {
    INIT: "init",
    REVIEW: "review",
    // kilocode_change start
    LOCAL_REVIEW: "local-review",
    LOCAL_REVIEW_UNCOMMITTED: "local-review-uncommitted",
    // kilocode_change end
  } as const

  // kilocode_change start - split static commands from dynamic (MCP/Skill) to avoid blocking
  // Static commands (builtin + user config) resolve quickly via Config.get()
  const state = Instance.state(async () => {
    const cfg = await Config.get()

    const result: Record<string, Info> = {
      [Default.INIT]: {
        name: Default.INIT,
        description: "create/update AGENTS.md",
        source: "command",
        get template() {
          return PROMPT_INITIALIZE.replace("${path}", Instance.worktree)
        },
        hints: hints(PROMPT_INITIALIZE),
      },
      [Default.REVIEW]: {
        name: Default.REVIEW,
        description: "review code changes",
        agent: "review",
        source: "command",
        template: "Start a code review",
        hints: [],
      },
      [Default.LOCAL_REVIEW]: localReviewCommand(),
      [Default.LOCAL_REVIEW_UNCOMMITTED]: localReviewUncommittedCommand(),
    }

    for (const [name, command] of Object.entries(cfg.command ?? {})) {
      result[name] = {
        name,
        agent: command.agent,
        model: command.model,
        description: command.description,
        source: "command",
        get template() {
          return command.template
        },
        subtask: command.subtask,
        hints: hints(command.template),
      }
    }

    return result
  })

  // Dynamic commands (MCP prompts + Skills) may be slow to load
  let resolved = false
  const dynamic = Instance.state(async () => {
    const result: Record<string, Info> = {}

    const [prompts, skills] = await Promise.all([
      MCP.prompts().catch(() => ({}) as Record<string, never>),
      Skill.all().catch(() => [] as Awaited<ReturnType<typeof Skill.all>>),
    ])

    for (const [name, prompt] of Object.entries(prompts)) {
      result[name] = {
        name,
        source: "mcp",
        description: prompt.description,
        get template() {
          // since a getter can't be async we need to manually return a promise here
          return new Promise<string>(async (resolve, reject) => {
            const template = await MCP.getPrompt(
              prompt.client,
              prompt.name,
              prompt.arguments
                ? // substitute each argument with $1, $2, etc.
                  Object.fromEntries(prompt.arguments?.map((argument, i) => [argument.name, `$${i + 1}`]))
                : {},
            ).catch(reject)
            resolve(
              template?.messages
                .map((message) => (message.content.type === "text" ? message.content.text : ""))
                .join("\n") || "",
            )
          })
        },
        hints: prompt.arguments?.map((_, i) => `$${i + 1}`) ?? [],
      }
    }

    // Add skills as invokable commands
    for (const skill of skills) {
      if (result[skill.name]) continue
      result[skill.name] = {
        name: skill.name,
        description: skill.description,
        source: "skill",
        get template() {
          return skill.content
        },
        hints: [],
      }
    }

    resolved = true
    return result
  })
  // kilocode_change end

  // kilocode_change start - get/list merge static + dynamic commands
  export async function get(name: string) {
    const s = await state()
    if (s[name]) return s[name]
    const d = await dynamic()
    return d[name]
  }

  export async function list() {
    const s = await state()
    const d = await dynamic()
    return Object.values({ ...d, ...s })
  }

  // Return static commands immediately, plus any dynamic commands that have already resolved.
  // This avoids blocking the API response on slow MCP/Skill loading.
  export async function listReady() {
    const s = await state()
    const d = resolved ? await dynamic() : {}
    return Object.values({ ...d, ...s })
  }
  // kilocode_change end
}
