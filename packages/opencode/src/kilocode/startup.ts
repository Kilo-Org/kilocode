const enabled = process.env.KILO_PROFILE_STARTUP === "1"
const start = performance.now()
let role = process.env.KILO_PROCESS_ROLE ?? "main"

function round(value: number) {
  return Math.round(value * 100) / 100
}

export namespace Startup {
  export function active() {
    return enabled
  }

  export function setRole(value: string) {
    role = value
  }

  export function mark(phase: string, details: Record<string, unknown> = {}) {
    if (!enabled) return
    try {
      process.stderr.write(
        `[startup] ${JSON.stringify({
          phase,
          elapsed: round(performance.now() - start),
          uptime: round(performance.now()),
          pid: process.pid,
          role,
          ...details,
        })}\n`,
      )
    } catch {
      return
    }
  }

  export function timer(phase: string, details: Record<string, unknown> = {}) {
    if (!enabled) return () => {}
    const begin = performance.now()
    return () => mark(phase, { ...details, duration: round(performance.now() - begin) })
  }

  export function measure<T>(phase: string, fn: () => Promise<T>, details: Record<string, unknown> = {}) {
    if (!enabled) return fn()
    const begin = performance.now()
    return Promise.resolve()
      .then(fn)
      .then(
        (result) => {
          mark(phase, { ...details, duration: round(performance.now() - begin) })
          return result
        },
        (error) => {
          mark(phase, { ...details, duration: round(performance.now() - begin), error: true })
          throw error
        },
      )
  }
}
