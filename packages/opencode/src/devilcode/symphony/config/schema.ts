import z from "zod"

const ENV_VAR_PATTERN = /^\$[A-Z_][A-Z0-9_]*$/

function resolveEnvVar(value: string): string {
  if (ENV_VAR_PATTERN.test(value)) {
    const varName = value.slice(1)
    const resolved = process.env[varName]
    if (!resolved) throw new Error(`Environment variable ${varName} is not set`)
    return resolved
  }
  return value
}

export const TrackerConfig = z.object({
  kind: z.literal("linear"),
  endpoint: z.string().default("https://api.linear.app/graphql"),
  api_key: z.string().transform(resolveEnvVar),
  project_slug: z.string(),
  active_states: z.array(z.string()).default(["Todo", "In Progress"]),
  terminal_states: z.array(z.string()).default(["Closed", "Cancelled", "Done", "Duplicate"]),
})
export type TrackerConfig = z.infer<typeof TrackerConfig>

export const PollingConfig = z.object({
  interval_ms: z.number().int().positive().default(30000),
})
export type PollingConfig = z.infer<typeof PollingConfig>

export const WorkspaceConfig = z.object({
  root: z
    .string()
    .default("")
    .transform((v) => {
      if (!v) return ""
      const resolved = resolveEnvVar(v)
      return resolved.startsWith("~") ? resolved.replace("~", process.env.HOME ?? process.env.USERPROFILE ?? "") : resolved
    }),
  cleanup: z.boolean().default(true),
})
export type WorkspaceConfig = z.infer<typeof WorkspaceConfig>

export const HooksConfig = z.object({
  after_create: z.string().optional(),
  before_run: z.string().optional(),
  after_run: z.string().optional(),
  before_remove: z.string().optional(),
  timeout_ms: z.number().int().positive().default(60000),
})
export type HooksConfig = z.infer<typeof HooksConfig>

export const AgentConfig = z.object({
  max_concurrent_agents: z.number().int().positive().default(5),
  max_turns: z.number().int().positive().default(20),
  max_retry_backoff_ms: z.number().int().positive().default(300000),
  model: z.string().optional(),
  max_concurrent_agents_by_state: z.record(z.string(), z.number().int().positive()).default({}),
})
export type AgentConfig = z.infer<typeof AgentConfig>

export const ServerConfig = z.object({
  port: z.number().int().min(0).default(0),
})
export type ServerConfig = z.infer<typeof ServerConfig>

export const SymphonyConfig = z.object({
  tracker: TrackerConfig,
  polling: PollingConfig.optional().transform((v) => PollingConfig.parse(v ?? {})),
  workspace: WorkspaceConfig.optional().transform((v) => WorkspaceConfig.parse(v ?? {})),
  hooks: HooksConfig.optional().transform((v) => HooksConfig.parse(v ?? {})),
  agent: AgentConfig.optional().transform((v) => AgentConfig.parse(v ?? {})),
  server: ServerConfig.optional().transform((v) => ServerConfig.parse(v ?? {})),
})
export type SymphonyConfig = z.infer<typeof SymphonyConfig>
