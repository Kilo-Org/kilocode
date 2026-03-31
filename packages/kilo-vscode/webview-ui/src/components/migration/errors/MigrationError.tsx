/** @jsxImportSource solid-js */

import { Show } from "solid-js"
import type { Component } from "solid-js"
import { showToast } from "@kilocode/kilo-ui/toast"
import { useLanguage } from "../../../context/language"
import "./error-styles.css"

async function copyMigrationError(text: string, t: (key: string, params?: Record<string, string>) => string) {
  await navigator.clipboard.writeText(text)
  showToast({ variant: "success", title: t("migration.error.toast.copied") })
}

interface MigrationErrorProps {
  when: boolean
  error?: string
  detail?: string
}

const MigrationError: Component<MigrationErrorProps> = (props) => {
  const language = useLanguage()

  return (
    <Show when={props.when && props.error}>
      <div class="migration-wizard__error-box">
        <div class="migration-wizard__error-box-header">
          <div class="migration-wizard__error-box-title">Session migration failed</div>
          <button type="button" class="migration-wizard__copy-btn" onClick={() => void copyMigrationError(props.error!, language.t)}>
            {language.t("migration.error.action.copy")}
          </button>
        </div>
        <div class="migration-wizard__error-text">{props.detail}</div>
        <pre class="migration-wizard__error-code">{props.error}</pre>
      </div>
    </Show>
  )
}

export default MigrationError
