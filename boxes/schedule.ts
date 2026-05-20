/**
 * schedule.ts — Retry schedule patterns (exponential/fibonacci)
 * Inspired by Effect-TS Schedule (MIT)
 * Deps: none
 */

export interface ScheduleStep {
  delay: number
  attempt: number
  done: boolean
}

export interface ScheduleBuilder {
  next(): ScheduleStep
  reset(): void
}

export function exponential(baseMs: number, factor = 2, maxRetries = Infinity): ScheduleBuilder {
  let attempt = 0
  return {
    next: () => {
      if (attempt >= maxRetries) return { delay: 0, attempt, done: true }
      const delay = baseMs * Math.pow(factor, attempt)
      return { delay, attempt: attempt++, done: false }
    },
    reset: () => { attempt = 0 },
  }
}

export function fibonacci(oneMs: number, maxRetries = Infinity): ScheduleBuilder {
  let a = 0, b = 1, attempt = 0
  return {
    next: () => {
      if (attempt >= maxRetries) return { delay: 0, attempt, done: true }
      const delay = a * oneMs; [a, b] = [b, a + b]
      return { delay, attempt: attempt++, done: false }
    },
    reset: () => { a = 0; b = 1; attempt = 0 },
  }
}

export function capDelay(maxMs: number, s: ScheduleBuilder): ScheduleBuilder {
  return {
    next: () => { const r = s.next(); return { ...r, delay: Math.min(r.delay, maxMs) } },
    reset: () => { s.reset() },
  }
}

export async function retryWith<T>(fn: (attempt: number) => Promise<T>, s: ScheduleBuilder): Promise<T> {
  for (;;) {
    const step = s.next()
    if (step.done) throw new Error(`Retry exhausted after ${step.attempt} attempts`)
    if (step.attempt > 0) await new Promise(r => setTimeout(r, step.delay))
    try { const v = await fn(step.attempt); s.reset(); return v } catch { continue }
  }
}
