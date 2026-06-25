export type CaptureReason = "completed" | "error" | "interrupted"

export function typedCapture(input: { reason?: CaptureReason; signal?: boolean; interval: boolean }) {
  const completed = !input.reason || input.reason === "completed"
  const fresh = !input.interval
  return {
    call: completed && fresh,
    work: completed && fresh,
  }
}

export function capturePlan(input: {
  reason?: CaptureReason
  summary: string
  echo: boolean
  durable: boolean
  priorTime: number
  now: number
  minIntervalMs: number
  lastConsolidatedAt: number | null | undefined
  bypassInterval?: boolean
  autoConsolidate: boolean
}) {
  const completed = !input.reason || input.reason === "completed"
  const session = input.autoConsolidate && completed && !input.echo && Boolean(input.summary)
  const digestDue =
    session &&
    (!input.priorTime ||
      !Number.isFinite(input.priorTime) ||
      input.now - input.priorTime >= input.minIntervalMs ||
      input.durable)
  const interval = Boolean(
    !input.bypassInterval &&
      input.lastConsolidatedAt &&
      input.now - input.lastConsolidatedAt < input.minIntervalMs &&
      !input.durable,
  )
  const typed = typedCapture({ reason: input.reason, interval })
  const typedCall = input.autoConsolidate && typed.call && session
  const typedWork = input.autoConsolidate && typed.work && session
  const skipReason =
    !digestDue && !typedWork
      ? input.echo && completed
        ? "memory_echo"
        : interval && (input.reason === undefined || input.reason === "completed")
          ? "interval"
          : "no_work"
      : undefined
  return {
    completed,
    session,
    digestDue,
    interval,
    typedCall,
    typedWork,
    skipReason,
    idleFlush: skipReason === "interval" && session,
  }
}
