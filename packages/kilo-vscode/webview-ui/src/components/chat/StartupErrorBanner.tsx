/**
 * StartupErrorBanner
 * Shown in the chat view when the CLI server fails to start.
 */

import { Component, createSignal, Show } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"

interface StartupErrorBannerProps {
  errorMessage: string
  errorDetails: string
}

export const StartupErrorBanner: Component<StartupErrorBannerProps> = (props) => {
  const language = useLanguage()
  const vscode = useVSCode()
  const [expanded, setExpanded] = createSignal(false)

  const retry = () => {
    vscode.postMessage({ type: "retryConnection" })
  }

  return (
    <div class="startup-error-banner">
      <div class="startup-error-header" onClick={() => setExpanded((v) => !v)} role="button" aria-expanded={expanded()}>
        <span class={`startup-error-chevron${expanded() ? " startup-error-chevron-expanded" : ""}`}>
          <Icon name="chevron-right" size="small" />
        </span>
        <span class="startup-error-title">
          {language.t("error.startup.title")}: <span class="startup-error-firstline">{props.errorMessage}</span>
        </span>
        <button
          class="startup-error-retry"
          onClick={(e) => {
            e.stopPropagation()
            retry()
          }}
          aria-label={language.t("common.retry")}
        >
          {language.t("common.retry")}
        </button>
      </div>
      <Show when={expanded()}>
        <pre class="startup-error-details">{props.errorDetails}</pre>
      </Show>
    </div>
  )
}
