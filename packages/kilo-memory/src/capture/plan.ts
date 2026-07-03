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
  // Echo gates the DIGEST only. When the latest user text is non-trivial, still run the typed call —
  // the canonical short recall-assisted correction flow lives here and must not be swallowed.
  echoTypedAllowed?: boolean
}) {
  const completed = !input.reason || input.reason === "completed"
  const base = input.autoConsolidate && completed && Boolean(input.summary)
  const session = base && !input.echo
  // Typed capture may still run under echo when the user text is substantive; the typed prompt itself
  // rejects duplicates/self-referential content, so we trust it rather than block on the echo gate.
  const typedSession = base && (!input.echo || input.echoTypedAllowed === true)
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
  const typedCall = input.autoConsolidate && typed.call && typedSession
  const typedWork = input.autoConsolidate && typed.work && typedSession
  // Interrupted/error closes never call the model, but a non-LLM fallback digest still leaves a trace.
  const fallbackDigest = input.autoConsolidate && !completed && Boolean(input.summary)
  const skipReason =
    !digestDue && !typedWork
      ? input.echo && completed && !typedSession
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
    fallbackDigest,
    skipReason,
    idleFlush: skipReason === "interval" && session,
  }
}
