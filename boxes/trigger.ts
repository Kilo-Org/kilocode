/**
 * trigger.ts — Cron + interval trigger patterns
 * Inspired by n8n ScheduledTaskManager (Apache-2.0)
 * Deps: none
 */

export type ScheduleMode = "minute" | "hour" | "day" | "interval"

export interface ScheduleConfig {
  mode: ScheduleMode
  value?: number
  hour?: number
  minute?: number
}

export function scheduleToCron(cfg: ScheduleConfig): string {
  const s = Math.floor(Math.random() * 60)
  if (cfg.mode === "hour") return `${s} ${cfg.minute ?? 0} * * *`
  if (cfg.mode === "day") return `${s} ${cfg.minute ?? 0} ${cfg.hour ?? 0} * *`
  if (cfg.mode === "interval" && cfg.value) return `${s} */${cfg.value} * * *`
  return `${s} * * * *`
}

export function parseCronField(field: string, min: number, max: number): number[] {
  if (field === "*") return Array.from({ length: max - min + 1 }, (_, i) => min + i)
  if (field.startsWith("*/")) {
    const step = parseInt(field.slice(2))
    return Array.from({ length: Math.ceil((max - min + 1) / step) }, (_, i) => min + i * step)
  }
  return [parseInt(field)]
}

export function cronNextMs(expr: string): number {
  const [s, m, h] = expr.split(/\s+/)
  const now = Date.now()
  for (const addH of parseCronField(h, 0, 23)) {
    for (const addM of parseCronField(m, 0, 59)) {
      const d = new Date(now)
      d.setHours(addH, addM, parseInt(s), 0)
      if (d.getTime() > now) return d.getTime() - now
    }
  }
  return 60_000
}

export function createIntervalTrigger(ms: number, onTick: () => void): () => void {
  const id = setInterval(onTick, ms)
  return () => clearInterval(id)
}

export function createCronTrigger(expr: string, onTick: () => void): () => void {
  let active = true
  const sched = () => {
    if (!active) return
    setTimeout(() => { onTick(); sched() }, cronNextMs(expr))
  }
  sched()
  return () => { active = false }
}
