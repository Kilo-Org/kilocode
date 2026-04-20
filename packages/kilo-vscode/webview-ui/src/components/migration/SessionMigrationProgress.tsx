import { For } from "solid-js"
import type { Component } from "solid-js"
import type { LegacyMigrationSessionPhase, MigrationSessionInfo } from "../../types/messages"
import { useLanguage } from "../../context/language"
import SessionMigrationCard from "./SessionMigrationCard"
import { formatDate, formatText } from "./session-migration-format"

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

const steps: Step[] = ["preparing", "storing"]

const order: Step[] = ["preparing", "storing"]

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

function label(language: ReturnType<typeof useLanguage>, step: Step, progress: SessionMigrationProgressState) {
  if (step === "storing" && progress.phase === "skipped") return language.t("migration.sessionProgress.skipped")
  if (step === "preparing") return language.t("migration.sessionProgress.preparing")
  return language.t("migration.sessionProgress.storing")
}

const SessionMigrationProgress: Component<SessionMigrationProgressProps> = (props) => {
  const language = useLanguage()

  return (
    <SessionMigrationCard>
      <div class="migration-session-progress">
        <div class="migration-session-progress__header">
          {language.t("migration.sessionProgress.header", {
            current: String(props.progress.index),
            total: String(props.progress.total),
          })}
        </div>
        <div class="migration-session-progress__meta">
          <div
            class="migration-session-progress__directory"
            title={props.progress.session.directory || language.t("migration.sessionFormat.unknown")}
          >
            {formatText(language, props.progress.session.directory)}
          </div>
          <div class="migration-session-progress__meta-row">
            <span
              class="migration-session-progress__title"
              title={props.progress.session.title || language.t("migration.sessionFormat.unknown")}
            >
              {formatText(language, props.progress.session.title)}
            </span>
            <span class="migration-session-progress__date">{formatDate(language, props.progress.session.time)}</span>
          </div>
        </div>
        <div class="migration-session-progress__steps">
          <For each={steps}>
            {(step) => (
              <div class="migration-session-progress__step">
                <div
                  class={`migration-session-progress__dot migration-session-progress__dot--${state(step, props.progress.phase)}`}
                />
                <div class="migration-session-progress__step-text">
                  <span>{label(language, step, props.progress)}</span>
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
