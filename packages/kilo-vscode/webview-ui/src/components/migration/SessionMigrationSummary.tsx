import type { Component } from "solid-js"
import { For, Show, createMemo, createSignal } from "solid-js"
import SessionMigrationCard from "./SessionMigrationCard"
import type { SessionSummaryState } from "./session-migration-summary-state"
import { showToast } from "@kilocode/kilo-ui/toast"
import { errored, line, report } from "./session-migration-summary-format"
import { useLanguage } from "../../context/language"

interface SessionMigrationSummaryProps {
  summary: SessionSummaryState
  onForce: (ids: string[]) => void
}

const SessionMigrationSummary: Component<SessionMigrationSummaryProps> = (props) => {
  const language = useLanguage()
  const [all, setAll] = createSignal(false)
  const [selected, setSelected] = createSignal<string[]>([])

  const label = (name: string, count: number, desc?: string) => {
    const suffix = count > 0 ? ` (${count})` : ""
    const extra = desc ? ` - ${desc}` : ""
    return `${name}${extra}${suffix}:`
  }

  const handleCopy = async () => {
    const text = report(language, props.summary)
    if (!text) return
    await navigator.clipboard.writeText(text)
    showToast({ variant: "success", title: language.t("migration.sessionSummary.toast.copied") })
  }

  const skipped = createMemo(() => props.summary.skipped)
  const ids = createMemo(() => skipped().map((item) => item.id))
  const picked = createMemo(() => (all() ? ids() : selected()))

  const toggle = (id: string, next: boolean) => {
    setAll(false)
    setSelected((prev) => (next ? [...prev.filter((item) => item !== id), id] : prev.filter((item) => item !== id)))
  }

  const handleAll = (next: boolean) => {
    setAll(next)
    if (next) {
      setSelected([])
      return
    }
  }

  const handleForce = () => {
    const list = picked()
    if (list.length === 0) return
    props.onForce(list)
  }

  return (
    <SessionMigrationCard>
      <div class="migration-session-summary">
        <div class="migration-session-summary__row">
          <div class="migration-session-summary__title">{language.t("migration.sessionSummary.title")}</div>
          <button type="button" class="migration-wizard__copy-btn" onClick={() => void handleCopy()}>
            {language.t("migration.sessionSummary.copy")}
          </button>
        </div>
        <div class="migration-session-summary__section">
          <div class="migration-session-summary__label">
            {label(language.t("migration.sessionSummary.successful"), props.summary.imported.length)}
          </div>
          <div class="migration-session-summary__list migration-session-summary__list--success">
            <For each={props.summary.imported.length > 0 ? props.summary.imported : [undefined]}>
              {(item) => (
                <div class="migration-session-summary__item">
                  {item ? line(language, item) : language.t("migration.sessionSummary.none")}
                </div>
              )}
            </For>
          </div>
        </div>
        <Show when={props.summary.skipped.length > 0}>
          <div class="migration-session-summary__section">
            <div class="migration-session-summary__label">
              {label(
                language.t("migration.sessionSummary.skipped"),
                props.summary.skipped.length,
                language.t("migration.sessionSummary.alreadyMigrated"),
              )}
            </div>
            <div class="migration-session-summary__list migration-session-summary__list--skipped">
              <For each={props.summary.skipped}>
                {(item) => (
                  <label class="migration-session-summary__pick">
                    <span class="migration-session-summary__item">{line(language, item)}</span>
                    <input
                      type="checkbox"
                      checked={all() || selected().includes(item.id)}
                      onChange={(event) => toggle(item.id, event.currentTarget.checked)}
                    />
                    <span class="migration-session-summary__pick-mark">
                      <svg
                        viewBox="0 0 12 12"
                        fill="none"
                        stroke="#fff"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <polyline points="2.5 6 5 8.5 9.5 3.5" />
                      </svg>
                    </span>
                  </label>
                )}
              </For>
            </div>
            <div class="migration-session-summary__actions">
              <label class="migration-session-summary__all">
                <span>{language.t("migration.forceReimport.all")}</span>
                <input type="checkbox" checked={all()} onChange={(event) => handleAll(event.currentTarget.checked)} />
                <span class="migration-session-summary__pick-mark migration-session-summary__pick-mark--all">
                  <svg
                    viewBox="0 0 12 12"
                    fill="none"
                    stroke="#fff"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <polyline points="2.5 6 5 8.5 9.5 3.5" />
                  </svg>
                </span>
              </label>
              <button
                type="button"
                class="migration-wizard__copy-btn"
                disabled={picked().length === 0}
                onClick={() => handleForce()}
              >
                {language.t("migration.forceReimport.button")}
              </button>
            </div>
          </div>
        </Show>
        <Show when={props.summary.errored.length > 0}>
          <div class="migration-session-summary__section">
            <div class="migration-session-summary__label">
              {label(language.t("migration.sessionSummary.errored"), props.summary.errored.length)}
            </div>
            <div class="migration-session-summary__list migration-session-summary__list--errored">
              <For each={errored(language, props.summary)}>
                {(item) =>
                  item.kind === "detail" ? (
                    <div class="migration-session-summary__detail">{item.text}</div>
                  ) : (
                    <div class="migration-session-summary__item">{item.text}</div>
                  )
                }
              </For>
            </div>
          </div>
        </Show>
      </div>
    </SessionMigrationCard>
  )
}

export default SessionMigrationSummary
