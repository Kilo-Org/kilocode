import { Icon } from "@kilocode/kilo-ui/icon"
import { createSignal, Show } from "solid-js"
import { useLanguage } from "../context/language"
import type { Failure } from "./error"

/**
 * The failure banner above the composer. It names what happened in a sentence, keeps the technical
 * text behind a details disclosure, and can be dismissed while its cause is being resolved.
 */
export function ErrorBanner(props: { failure: Failure; onDismiss?: () => void }) {
  const language = useLanguage()
  const [expanded, setExpanded] = createSignal(false)
  return (
    <div class="startup-error-banner" role="alert" data-component="v2-error">
      <div class="startup-error-header">
        <Show
          when={props.failure.details}
          fallback={<span class="startup-error-message">{props.failure.message}</span>}
        >
          <button class="startup-error-toggle" aria-expanded={expanded()} onClick={() => setExpanded((open) => !open)}>
            <span
              classList={{ "startup-error-chevron": true, "startup-error-chevron-expanded": expanded() }}
              aria-hidden="true"
            >
              <Icon name="chevron-right" size="small" />
            </span>
            <span class="startup-error-message">{props.failure.message}</span>
          </button>
        </Show>
        <Show when={props.onDismiss}>
          <button class="startup-error-dismiss" onClick={() => props.onDismiss?.()}>
            {language.t("common.dismiss")}
          </button>
        </Show>
      </div>
      <Show when={expanded() ? props.failure.details : undefined}>
        {(details) => (
          <pre class="startup-error-details" data-scrollable>
            {details()}
          </pre>
        )}
      </Show>
    </div>
  )
}
