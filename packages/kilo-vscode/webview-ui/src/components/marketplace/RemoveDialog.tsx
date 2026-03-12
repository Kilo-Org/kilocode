import { Component, Show, createMemo } from "solid-js"
import { useLanguage } from "../../context/language"
import type { MarketplaceItem } from "../../types/marketplace"

interface RemoveDialogProps {
  item: MarketplaceItem | null
  scope: "project" | "global"
  onClose: () => void
  onConfirm: () => void
}

export const RemoveDialog: Component<RemoveDialogProps> = (props) => {
  const { t } = useLanguage()

  const label = createMemo(() => {
    if (!props.item) return ""
    if (props.item.type === "mcp") return t("marketplace.remove.type.mcp")
    if (props.item.type === "skill") return t("marketplace.remove.type.skill")
    return t("marketplace.remove.type.mode")
  })

  const scopeLabel = createMemo(() =>
    props.scope === "project" ? t("marketplace.remove.scope.project") : t("marketplace.remove.scope.global"),
  )

  return (
    <Show when={props.item}>
      <div class="install-modal-overlay" onClick={props.onClose}>
        <div class="install-modal" onClick={(e) => e.stopPropagation()}>
          <div class="install-modal-header">
            <h3>{t("marketplace.remove.title", { name: props.item!.name })}</h3>
          </div>
          <div class="install-modal-body">
            <p>{t("marketplace.remove.confirm", { type: label(), scope: scopeLabel() })}</p>
          </div>
          <div class="install-modal-footer">
            <button class="install-modal-cancel" onClick={props.onClose}>
              {t("marketplace.remove.cancel")}
            </button>
            <button class="install-modal-submit danger" onClick={props.onConfirm}>
              {t("marketplace.remove.submit")}
            </button>
          </div>
        </div>
      </div>
    </Show>
  )
}
