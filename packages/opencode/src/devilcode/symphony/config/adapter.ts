import type { SymphonyConfig } from "./schema"

interface TeamSymphonyConfig {
  enabled: boolean
  tracker: {
    kind: "linear"
    apiKey: string
    endpoint?: string
    projectSlug: string
    activeStates?: string[]
    terminalStates?: string[]
  }
  polling?: { intervalMs?: number }
  workspace?: { root?: string; cleanup?: boolean }
  hooks?: {
    afterCreate?: string
    beforeRun?: string
    afterRun?: string
    beforeRemove?: string
    timeoutMs?: number
  }
  agent?: {
    maxConcurrent?: number
    maxTurns?: number
    maxRetryBackoffMs?: number
    model?: string
    maxConcurrentByState?: Record<string, number>
  }
  promptTemplate: string
  server?: { port?: number }
}

export function teamConfigToSymphony(team: TeamSymphonyConfig): { config: SymphonyConfig; promptTemplate: string } {
  return {
    config: {
      tracker: {
        kind: team.tracker.kind,
        endpoint: team.tracker.endpoint ?? "https://api.linear.app/graphql",
        api_key: team.tracker.apiKey,
        project_slug: team.tracker.projectSlug,
        active_states: team.tracker.activeStates ?? ["Todo", "In Progress"],
        terminal_states: team.tracker.terminalStates ?? ["Closed", "Cancelled", "Done", "Duplicate"],
      },
      polling: {
        interval_ms: team.polling?.intervalMs ?? 30000,
      },
      workspace: {
        root: team.workspace?.root ?? "",
        cleanup: team.workspace?.cleanup ?? true,
      },
      hooks: {
        after_create: team.hooks?.afterCreate,
        before_run: team.hooks?.beforeRun,
        after_run: team.hooks?.afterRun,
        before_remove: team.hooks?.beforeRemove,
        timeout_ms: team.hooks?.timeoutMs ?? 60000,
      },
      agent: {
        max_concurrent_agents: team.agent?.maxConcurrent ?? 5,
        max_turns: team.agent?.maxTurns ?? 20,
        max_retry_backoff_ms: team.agent?.maxRetryBackoffMs ?? 300000,
        model: team.agent?.model,
        max_concurrent_agents_by_state: team.agent?.maxConcurrentByState ?? {},
      },
      server: {
        port: team.server?.port ?? 0,
      },
    },
    promptTemplate: team.promptTemplate,
  }
}

export function symphonyToTeamConfig(
  config: SymphonyConfig,
  promptTemplate: string,
): TeamSymphonyConfig {
  return {
    enabled: true,
    tracker: {
      kind: config.tracker.kind,
      apiKey: config.tracker.api_key,
      endpoint: config.tracker.endpoint,
      projectSlug: config.tracker.project_slug,
      activeStates: config.tracker.active_states,
      terminalStates: config.tracker.terminal_states,
    },
    polling: { intervalMs: config.polling.interval_ms },
    workspace: { root: config.workspace.root, cleanup: config.workspace.cleanup },
    hooks: {
      afterCreate: config.hooks.after_create,
      beforeRun: config.hooks.before_run,
      afterRun: config.hooks.after_run,
      beforeRemove: config.hooks.before_remove,
      timeoutMs: config.hooks.timeout_ms,
    },
    agent: {
      maxConcurrent: config.agent.max_concurrent_agents,
      maxTurns: config.agent.max_turns,
      maxRetryBackoffMs: config.agent.max_retry_backoff_ms,
      model: config.agent.model,
      maxConcurrentByState: config.agent.max_concurrent_agents_by_state,
    },
    promptTemplate,
    server: { port: config.server.port },
  }
}
