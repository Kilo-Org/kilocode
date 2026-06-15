import {
  buildWorkStyleApplyPlan,
  type WorkStyle,
  type WorkStyleConfig,
  type WorkStyleSettings,
} from "../shared/work-style-presets"

type Setting = keyof WorkStyleSettings | "agentWorkStyle"

export interface WorkStyleSettingSnapshot {
  customized: boolean
  global: unknown
}

export interface WorkStyleStore {
  read: () => Promise<WorkStyleConfig>
  inspect: (key: Setting) => WorkStyleSettingSnapshot
  write: (key: Setting, value: unknown) => Promise<void>
  patch: (config: WorkStyleConfig) => Promise<void>
}

type WorkStyleApplyResult =
  | { ok: true }
  | {
      ok: false
      error: string
      rollback: Setting[]
    }

function message(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

export async function applyWorkStyle(style: WorkStyle, store: WorkStyleStore): Promise<WorkStyleApplyResult> {
  const completed: Array<{ key: Setting; value: unknown }> = []

  try {
    const config = await store.read()
    const plan = buildWorkStyleApplyPlan({
      style,
      config,
      settingDefault: (key) => !store.inspect(key).customized,
    })
    const writes: Array<{ key: Setting; value: unknown }> = [
      ...Object.entries(plan.settings).map(([key, value]) => ({ key: key as keyof WorkStyleSettings, value })),
      { key: "agentWorkStyle", value: style },
    ]

    for (const write of writes) {
      completed.push({ key: write.key, value: store.inspect(write.key).global })
      await store.write(write.key, write.value)
    }
    if (Object.keys(plan.config).length > 0) await store.patch(plan.config)
    return { ok: true }
  } catch (err) {
    const rollback: Setting[] = []
    for (const write of [...completed].reverse()) {
      await store.write(write.key, write.value).catch(() => rollback.push(write.key))
    }
    return { ok: false, error: message(err), rollback }
  }
}
