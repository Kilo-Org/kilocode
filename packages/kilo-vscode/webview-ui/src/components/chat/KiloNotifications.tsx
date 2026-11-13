import { Component, Show, createEffect, createMemo, createSignal } from "solid-js"
import type { NotificationsContextValue } from "../../context/notifications"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import { useV2 } from "../../v2/client"
import { TelemetryEventName } from "../../../../src/services/telemetry/types"
import type { Selection } from "../../v2/selectors"
import { KILO_PROVIDER_ID } from "../settings/provider-catalog"
import { stripSubProviderPrefix } from "../shared/model-selector-filter"

const MAX_NAME = 30

export const KiloNotifications: Component<{
  notifications: NotificationsContextValue
  selection: Selection
}> = (props) => {
  const v2 = useV2()
  const vscode = useVSCode()
  const language = useLanguage()
  const [index, setIndex] = createSignal(0)

  const items = props.notifications.filteredNotifications
  const total = () => items().length
  const safeIndex = () => Math.min(index(), Math.max(0, total() - 1))
  const current = createMemo(() => (total() === 0 ? undefined : items()[safeIndex()]))

  // Clamp the index whenever the list shrinks, so navigation always reflects the current list.
  createEffect(() => {
    const max = Math.max(0, total() - 1)
    if (index() > max) setIndex(max)
  })

  const isLast = () => safeIndex() === total() - 1

  const handleNext = () => {
    if (isLast()) {
      for (const item of items()) props.notifications.dismiss(item.id)
      return
    }
    setIndex(safeIndex() + 1)
  }

  const suggestedModel = createMemo(() => {
    const id = current()?.suggestModelId
    if (!id) return undefined
    const found = props.selection.models()?.find((model) => model.providerID === KILO_PROVIDER_ID && model.id === id)
    if (!found) return undefined
    return found
  })

  const canSwitchModel = createMemo(() => {
    const model = suggestedModel()
    if (!model) return false
    const selected = props.selection.model()
    return !selected || selected.providerID !== model.providerID || selected.id !== model.id
  })

  const suggestedName = createMemo(() => {
    const model = suggestedModel()
    if (!model?.name) return undefined
    const name = stripSubProviderPrefix(model.name)
    if (name.length > MAX_NAME) return undefined
    return name
  })

  const handleTryModel = () => {
    const model = suggestedModel()
    if (!model) return
    props.selection.selectModel(model.providerID, model.id)
    vscode.postMessage({
      type: "telemetry",
      event: TelemetryEventName.NOTIFICATION_CLICKED,
      properties: { actionText: "Try model", suggestModelId: current()?.suggestModelId },
    })
  }

  const open = (url: string) => v2.open(url)

  return (
    <Show when={total() > 0}>
      <div class="kilo-notifications">
        <div class="kilo-notifications-card">
          <div class="kilo-notifications-header">
            <span class="kilo-notifications-title">{current()?.title}</span>
            <Show when={total() > 1}>
              <span class="kilo-notifications-nav-count">
                {safeIndex() + 1} / {total()}
              </span>
            </Show>
          </div>
          <p class="kilo-notifications-message">{current()?.message}</p>
          <div class="kilo-notifications-footer">
            <div class="kilo-notifications-cta-group">
              <Show when={canSwitchModel()}>
                <button class="kilo-notifications-action-btn" onClick={handleTryModel}>
                  {suggestedName()
                    ? language.t("notifications.action.tryModel", { model: suggestedName()! })
                    : language.t("notifications.action.tryModelGeneric")}
                </button>
              </Show>
              <Show when={current()?.action}>
                {(action) => (
                  <button class="kilo-notifications-action-btn" onClick={() => open(action().actionURL)}>
                    {action().actionText}
                  </button>
                )}
              </Show>
            </div>
            <div class="kilo-notifications-next-group">
              <Show when={safeIndex() > 0}>
                <button class="kilo-notifications-back-link" onClick={() => setIndex(safeIndex() - 1)}>
                  {language.t("common.goBack")}
                </button>
              </Show>
              <button class="kilo-notifications-primary-btn" onClick={handleNext}>
                {isLast() ? language.t("notifications.action.close") : language.t("notifications.action.next")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Show>
  )
}
