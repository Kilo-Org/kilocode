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
  lastTypedConsolidationAt: number | null | undefined
  bypassInterval?: boolean
  autoConsolidate: boolean
}) {
  const completed = !input.reason || input.reason === "completed"
  const base = input.autoConsolidate && completed && Boolean(input.summary)
  // Echo only suppresses session digests; lookup answers should not create digest noise.
  const session = base && !input.echo
  // Typed capture trusts the prompt as the content filter and remains bounded by the interval throttle.
  const typedSession = base
  const trivial = Boolean(input.summary) && !input.durable && input.summary.length < 80
  const digestDue =
    session &&
    !trivial &&
    (!input.priorTime ||
      !Number.isFinite(input.priorTime) ||
      input.now - input.priorTime >= input.minIntervalMs ||
      input.durable)
  const interval = Boolean(
    !input.bypassInterval &&
      input.lastTypedConsolidationAt &&
      input.now - input.lastTypedConsolidationAt < input.minIntervalMs &&
      !input.durable,
  )
  const typed = typedCapture({ reason: input.reason, interval })
  const typedCall = input.autoConsolidate && typed.call && typedSession
  const typedWork = input.autoConsolidate && typed.work && typedSession
  // Interrupted/error closes never call the model, but a non-LLM fallback digest still leaves a trace.
  const fallbackDigest = input.autoConsolidate && !completed && Boolean(input.summary) && !trivial
  const skipReason =
    digestDue || typedWork
      ? undefined
      : trivial
        ? "trivial"
        : interval && (input.reason === undefined || input.reason === "completed")
          ? "interval"
        : "no_work"
  return {
    completed,
    session,
    digestDue,
    interval,
    typedCall,
    typedWork,
    fallbackDigest,
    skipReason,
    idleFlush: skipReason === "interval" && session,
  }
}
