import {
  buildWorkStyleApplyPlan,
  isOnboardingAgent,
  type OnboardingAgent,
  type WorkStyle,
  type WorkStyleConfig,
  type WorkStyleSettings,
} from "../shared/work-style-presets"

type Setting = keyof WorkStyleSettings | "agentWorkStyle"
type ConfigKey = keyof WorkStyleConfig | "default_agent"
type Rollback = Setting | "config"

export type WorkStyleConfigPatch = {
  [Key in keyof WorkStyleConfig]?: WorkStyleConfig[Key] | null
} & { default_agent?: string | null }

export interface WorkStyleSettingSnapshot {
  customized: boolean
  global: unknown
}

export interface WorkStyleStore {
  read: () => Promise<WorkStyleConfig>
  global: () => Promise<WorkStyleConfigPatch>
  inspect: (key: Setting) => WorkStyleSettingSnapshot
  write: (key: Setting, value: unknown) => Promise<void>
  patch: (config: WorkStyleConfigPatch) => Promise<void>
}

type WorkStyleApplyResult =
  | { ok: true; style: WorkStyle; agent: OnboardingAgent }
  | {
      ok: false
      error: string
      rollback: Rollback[]
    }

function message(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function revert(value: unknown, previous: unknown): unknown {
  if (!record(value)) return previous ?? null
  if (!record(previous)) return previous ?? null
  if (Object.keys(previous).length === 0) return null

  const result: Record<string, unknown> = {}
  for (const key of Object.keys(value)) {
    if (Object.hasOwn(previous, key)) {
      result[key] = revert(value[key], previous[key])
      continue
    }
    result[key] = null
  }
  return result
}

function restore(patch: WorkStyleConfigPatch, global: WorkStyleConfigPatch): WorkStyleConfigPatch {
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(patch) as ConfigKey[]) {
    result[key] = revert(patch[key], global[key])
  }
  return result as WorkStyleConfigPatch
}

// Serialize onboarding choices.
let queue = Promise.resolve()

export function applyWorkStyle(style: WorkStyle, agent: string, store: WorkStyleStore): Promise<WorkStyleApplyResult> {
  const run = queue.then(() => apply(style, agent, store))
  queue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

async function apply(style: WorkStyle, agent: string, store: WorkStyleStore): Promise<WorkStyleApplyResult> {
  if (!isOnboardingAgent(agent)) return { ok: false, error: "Invalid default agent", rollback: [] }

  const completed: Array<{ key: Setting; value: unknown }> = []
  let previous: WorkStyleConfigPatch | undefined
  let patched = false

  try {
    const [config, global] = await Promise.all([store.read(), store.global()])
    const current = store.inspect("agentWorkStyle").global
    if (current === "human-in-the-loop" || current === "autonomous") {
      if (isOnboardingAgent(global.default_agent)) return { ok: true, style: current, agent: global.default_agent }
      return { ok: false, error: "Work style onboarding is already complete", rollback: [] }
    }
    const plan = buildWorkStyleApplyPlan({
      style,
      config,
      settingDefault: (key) => !store.inspect(key).customized,
    })
    const patch: WorkStyleConfigPatch = { ...plan.config, default_agent: agent }
    previous = restore(patch, global)

    for (const [name, value] of Object.entries(plan.settings)) {
      const key = name as keyof WorkStyleSettings
      completed.push({ key, value: store.inspect(key).global })
      await store.write(key, value)
    }

    patched = true
    await store.patch(patch)

    // Write the completion marker last.
    completed.push({ key: "agentWorkStyle", value: store.inspect("agentWorkStyle").global })
    await store.write("agentWorkStyle", style)
    return { ok: true, style, agent }
  } catch (err) {
    const rollback: Rollback[] = []
    if (patched && previous) await store.patch(previous).catch(() => rollback.push("config"))
    completed.reverse()
    for (const write of completed) {
      await store.write(write.key, write.value).catch(() => rollback.push(write.key))
    }
    return { ok: false, error: message(err), rollback }
  }
}
