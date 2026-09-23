import type { ConfigV1 } from "@opencode-ai/core/v1/config/config"

export namespace AutonomousConfig {
  export type Raw = NonNullable<ConfigV1.Info["autonomous_goal"]>

  export type Info = {
    enabled: boolean
    models: { local_small?: string; local_coder?: string; cloud_reasoner?: string }
    worker_max_attempts: number
    routing: { local_small_max_complexity: number; local_coder_max_complexity: number }
    stuck: { same_error_limit: number }
    budget: {
      cloud_task_max_usd: number
      cloud_goal_max_usd: number
      max_cloud_calls_per_task: number
      max_cloud_calls_per_goal: number
    }
    final_review_cloud_at_complexity: number
    checks?: string[]
  }

  export const defaults: Info = {
    enabled: false,
    models: {},
    worker_max_attempts: 2,
    routing: { local_small_max_complexity: 0, local_coder_max_complexity: 2 },
    stuck: { same_error_limit: 2 },
    budget: {
      cloud_task_max_usd: 2,
      cloud_goal_max_usd: 10,
      max_cloud_calls_per_task: 3,
      max_cloud_calls_per_goal: 20,
    },
    final_review_cloud_at_complexity: 3,
  }

  export function resolve(cfg: { autonomous_goal?: Raw }): Info {
    const raw = cfg.autonomous_goal ?? {}
    return {
      enabled: raw.enabled ?? defaults.enabled,
      models: { ...raw.models },
      worker_max_attempts: raw.worker_max_attempts ?? defaults.worker_max_attempts,
      routing: { ...defaults.routing, ...strip(raw.routing) },
      stuck: { ...defaults.stuck, ...strip(raw.stuck) },
      budget: { ...defaults.budget, ...strip(raw.budget) },
      final_review_cloud_at_complexity: raw.final_review_cloud_at_complexity ?? defaults.final_review_cloud_at_complexity,
      ...(raw.checks ? { checks: [...raw.checks] } : {}),
    }
  }

  export function enabled(cfg: { autonomous_goal?: Raw }) {
    return cfg.autonomous_goal?.enabled === true
  }

  function strip<T extends object>(value: T | undefined): Partial<T> {
    if (!value) return {}
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v != null)) as Partial<T>
  }
}
