import { For } from "solid-js"
import type { Component } from "solid-js"
import type { LegacyMigrationSessionPhase, MigrationSessionInfo } from "../../types/messages"
import SessionMigrationCard from "./SessionMigrationCard"

export interface SessionMigrationProgressState {
  session: MigrationSessionInfo
  index: number
  total: number
  phase: LegacyMigrationSessionPhase
  error?: string
}

interface SessionMigrationProgressProps {
  progress: SessionMigrationProgressState
}

type Step = "preparing" | "storing"
type StepState = "pending" | "active" | "success"

const steps: Array<{ key: Step; label: string }> = [
  { key: "preparing", label: "Preparing session" },
  { key: "storing", label: "Storing session" },
]

const order: Step[] = ["preparing", "storing"]

function formatDate(time: number) {
  if (!time) return "Unknown date"
  const date = new Date(time)
  const hour = new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date)
  const day = new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
  return `${hour} ${day}`
}

function text(value: string) {
  const next = value.trim()
  return next || "Unknown"
}

function current(phase: LegacyMigrationSessionPhase): Step | undefined {
  if (phase === "preparing" || phase === "storing") {
    return phase
  }
  if (phase === "skipped") return "storing"
  if (phase === "done") return "storing"
  if (phase === "error") return undefined
  return undefined
}

function state(step: Step, phase: LegacyMigrationSessionPhase): StepState {
  const active = current(phase)
  if (!active) return phase === "done" ? "success" : "pending"
  if (step === "preparing" && phase === "preparing") return "active"
  const i = order.indexOf(step)
  const a = order.indexOf(active)
  if (i < a) return "success"
  if (i === a) return phase === "done" ? "success" : "active"
  return "pending"
}

function label(step: Step, progress: SessionMigrationProgressState) {
  if (step === "storing" && progress.phase === "skipped") return "Session skipped"
  return steps.find((item) => item.key === step)?.label ?? ""
}

const SessionMigrationProgress: Component<SessionMigrationProgressProps> = (props) => {
  return (
    <SessionMigrationCard>
      <div class="migration-session-progress">
        <div class="migration-session-progress__header">{`Migrating ${props.progress.index} of ${props.progress.total}`}</div>
        <div class="migration-session-progress__meta">
          <div class="migration-session-progress__directory" title={props.progress.session.directory || "Unknown"}>
            {text(props.progress.session.directory)}
          </div>
          <div class="migration-session-progress__meta-row">
            <span class="migration-session-progress__title" title={props.progress.session.title || "Unknown"}>
              {text(props.progress.session.title)}
            </span>
            <span class="migration-session-progress__date">{formatDate(props.progress.session.time)}</span>
          </div>
        </div>
        <div class="migration-session-progress__steps">
          <For each={steps}>
            {(step) => (
              <div class="migration-session-progress__step">
                <div class={`migration-session-progress__dot migration-session-progress__dot--${state(step.key, props.progress.phase)}`} />
                <div class="migration-session-progress__step-text">
                  <span>{label(step.key, props.progress)}</span>
                </div>
              </div>
            )}
          </For>
        </div>
      </div>
    </SessionMigrationCard>
  )
}

export default SessionMigrationProgress
