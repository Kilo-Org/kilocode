import { scheduler } from "node:timers/promises"
import { Schema } from "effect"
import { KiloHostedRpc } from "@opencode/schema/kilocode/hosted"
import { SessionUnavailable } from "./error.js"
import { frames } from "./live-io.js"
import type { Request } from "./live-history.js"

type Progress = KiloHostedRpc.Progress
type State = NonNullable<Progress["preparation"]>
const record = Schema.Record(Schema.String, Schema.Unknown)
const frame = Schema.Struct({ type: Schema.String, properties: record })
const isStage = Schema.is(KiloHostedRpc.Stage)
const isState = Schema.is(Schema.Literals(["running", "completed", "failed"]))
const isPhase = Schema.is(Schema.Literals(["preparing", "ready", "finalizing", "error"]))
const isSandbox = Schema.is(
  Schema.Literals(["active", "sleeping", "starting", "stopping", "error", "unreachable", "unknown"]),
)
const isRecord = Schema.is(record)

export class Preparation {
  value: Progress = { steps: [] }
  private attempt?: string
  private since = -1
  private revision = -1
  private readonly revisions = new Map<KiloHostedRpc.Stage, number>()

  fromPage(attempts?: readonly unknown[]) {
    // First-page attempts are ordered oldest first. The independent stream may already have
    // advanced while the history page was in flight, so apply its revisions just like replay.
    const attempt = attempts?.at(-1)
    if (!isRecord(attempt) || !isState(attempt.status) || typeof attempt.id !== "string") return
    const prior = this.value
    if (!this.select(attempt.id, attempt.startedAt)) return
    this.setStatus(attempt.status, attempt.revision)
    if (Array.isArray(attempt.steps)) for (const step of attempt.steps) this.updateStep({ stepSnapshot: step })
    return JSON.stringify(this.value) !== JSON.stringify(prior) ? this.value : undefined
  }

  apply(raw: unknown, sessionID: string) {
    if (!Schema.is(frame)(raw)) return
    const p = raw.properties
    if (p.sessionID !== sessionID || p.directory !== `/cloud-agent/sessions/${sessionID}`) return
    const prior = this.value
    if (raw.type === "cloud.sandbox.status" && isRecord(p.sandbox) && isSandbox(p.sandbox.status))
      this.value = { ...prior, sandbox: p.sandbox.status }
    if (raw.type === "cloud.status" && isRecord(p.cloudStatus) && isPhase(p.cloudStatus.type)) {
      const { step: _, ...rest } = prior
      this.value = {
        ...rest,
        phase: p.cloudStatus.type,
        ...(isStage(p.cloudStatus.step) && { step: p.cloudStatus.step }),
      }
    }
    if (raw.type === "preparing" && isRecord(p.preparation)) this.prepare(p.preparation)
    return JSON.stringify(this.value) !== JSON.stringify(prior) ? this.value : undefined
  }

  private prepare(p: typeof record.Type) {
    const attempt = isRecord(p.attempt) ? p.attempt : undefined
    if (!this.select(p.attemptId, attempt?.startedAt ?? p.timestamp)) return
    if (p.action === "attempt_snapshot" && isState(attempt?.status))
      this.setStatus(attempt.status, attempt.revision ?? p.revision)
    if (p.action === "attempt_completed" || p.action === "attempt_failed")
      this.setStatus(p.action === "attempt_completed" ? "completed" : "failed", p.revision)
    this.updateStep(p)
  }

  private setStatus(preparation: State, revision: unknown) {
    if (typeof revision === "number") {
      if (revision < this.revision) return
      this.revision = revision
    }
    this.value = { ...this.value, preparation }
  }

  private updateStep(p: typeof record.Type) {
    const snapshot = isRecord(p.stepSnapshot) ? p.stepSnapshot : undefined
    const step = snapshot?.key ?? p.step
    const status = snapshot?.status ?? stepState(p.action, step)
    if (!isStage(step) || !isState(status)) return
    const revision = snapshot?.revision ?? p.revision
    if (typeof revision === "number" && revision < (this.revisions.get(step) ?? -1)) return
    if (typeof revision === "number") this.revisions.set(step, revision)
    const steps = [...this.value.steps]
    const index = steps.findIndex((s) => s.step === step)
    steps[index < 0 ? steps.length : index] = { step, status }
    this.value = { ...this.value, steps }
  }

  private select(id: unknown, start: unknown) {
    if (typeof id !== "string" || id === this.attempt) return true
    if (typeof start !== "number" || start < this.since || id.length > 255) return false
    this.attempt = id
    this.since = start
    this.revision = -1
    this.revisions.clear()
    this.value = { ...this.value, preparation: "running", steps: [] }
    return true
  }
}

function stepState(action: unknown, step: unknown): State | undefined {
  if (action === "step_failed" || step === "failed") return "failed"
  if (action === "step_completed" || step === "ready") return "completed"
  if (action === undefined || action === "step_started" || action === "step_progress") return "running"
}

/** The independent system stream replays preparation and sandbox state even when the execution stream is asleep. */
export async function followProgress(
  target: KiloHostedRpc.Target,
  request: Request,
  lifetime: AbortSignal,
  projection: Preparation,
  publish: (progress: Progress) => void,
) {
  const query = new URLSearchParams({ directory: `/cloud-agent/sessions/${target.sessionID}` })
  while (!lifetime.aborted) {
    const deadline = new AbortController()
    const signal = AbortSignal.any([lifetime, deadline.signal])
    const timer = setTimeout(() => deadline.abort(), 30_000)
    try {
      const response = await request(target, `/kilo/cloud-agent/event?${query}`, {
        method: "GET",
        headers: { accept: "text/event-stream" },
        signal,
      })
      for await (const event of frames(response, signal, () => timer.refresh())) {
        const next = projection.apply(event, target.sessionID)
        if (next) publish(next)
      }
    } catch (error) {
      if (error instanceof SessionUnavailable) throw error
      // Transcript delivery and commands do not depend on the availability of infrastructure observations.
    } finally {
      clearTimeout(timer)
      deadline.abort()
    }
    if (!lifetime.aborted) await scheduler.wait(10_000, { signal: lifetime }).catch(() => {})
  }
}
