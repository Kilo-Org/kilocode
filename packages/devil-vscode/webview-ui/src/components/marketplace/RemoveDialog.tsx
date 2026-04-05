import { Dialog } from "@kilocode/kilo-ui/dialog"
import { Button } from "@kilocode/kilo-ui/button"
import type { MarketplaceItem } from "../../types/marketplace"
import { useLanguage } from "../../context/language"

interface Props {
  item: MarketplaceItem
  scope: "project" | "global"
  onClose: () => void
  onConfirm: () => void
}

export const RemoveDialog = (props: Props) => {
  const { t } = useLanguage()

  const typeName = () => {
    if (props.item.type === "mcp") return t("marketplace.remove.type.mcp")
    if (props.item.type === "mode") return t("marketplace.remove.type.mode")
    return t("marketplace.remove.type.skill")
  }

  return (
    <Dialog title={t("marketplace.remove.title", { name: props.item.name })} fit>
      <p>{t("marketplace.remove.confirm", { type: typeName(), scope: t(`marketplace.scope.${props.scope}`) })}</p>
      <div class="marketplace-remove-actions">
        <Button variant="secondary" onClick={props.onClose}>
          {t("marketplace.remove.cancel")}
        </Button>
        <Button variant="primary" class="danger-btn" onClick={props.onConfirm}>
          {t("marketplace.remove.confirm.button")}
        </Button>
      </div>
    </Dialog>
  )
}
