import type { Component } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { useLanguage } from "../../src/context/language"

/** Static placeholders keep the reading lane visible during network latency without flashing another spinner. */
export const CloudHistoryPlaceholder: Component = () => {
  const { t } = useLanguage()
  return (
    <div class="am-hosted-history-load" role="status">
      <span class="am-hosted-history-label">
        <Icon name="cloud" size="small" />
        {t("session.messages.loading")}
      </span>
      <div class="am-hosted-history-shapes" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
    </div>
  )
}
