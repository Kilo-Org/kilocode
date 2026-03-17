import { Component } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import type { MarketplaceItem } from "../../types/marketplace"
import { useLanguage } from "../../context/language"

interface Props {
  item: MarketplaceItem
  scope: "project" | "global"
  onClose: () => void
  onConfirm: () => void
}

const RemoveDialog: Component<Props> = (props) => {
  const { t } = useLanguage()

  return (
    <div class="marketplace-modal-overlay" onClick={props.onClose}>
      <div class="marketplace-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t("marketplace.remove.title", { name: props.item.name })}</h3>
        <p>{t("marketplace.remove.confirm", { type: props.item.type, scope: props.scope })}</p>
        <div class="marketplace-modal-actions">
          <Button variant="secondary" onClick={props.onClose}>
            {t("marketplace.remove.cancel")}
          </Button>
          <Button variant="primary" class="marketplace-remove-btn" onClick={props.onConfirm}>
            {t("marketplace.remove.confirm.button")}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default RemoveDialog
