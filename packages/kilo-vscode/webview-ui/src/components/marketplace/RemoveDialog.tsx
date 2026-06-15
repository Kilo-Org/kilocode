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
    if (props.item.type === "agent") return t("marketplace.remove.type.agent")
    return t("marketplace.remove.type.skill")
  }

  return (
    <Dialog title={t("marketplace.remove.title", { name: props.item.name })} fit>
      <div class="dialog-confirm-body">
        <span>
          {t("marketplace.remove.confirm", { type: typeName(), scope: t(`marketplace.scope.${props.scope}`) })}
        </span>
        <div class="dialog-confirm-actions">
          <Button variant="secondary" onClick={props.onClose}>
            {t("marketplace.remove.cancel")}
          </Button>
          <Button variant="primary" class="danger-btn" onClick={props.onConfirm}>
            {t("marketplace.remove.confirm.button")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
