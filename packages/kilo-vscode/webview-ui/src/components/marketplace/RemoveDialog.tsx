import { Show } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { useLanguage } from "../../context/language"
import type { MarketplaceRecord } from "../../v2/marketplace-data"
import { kindLabel } from "./utils"

interface Props {
  record: MarketplaceRecord
  name: string
  onClose: () => void
  onConfirm: () => void
}

export const RemoveDialog = (props: Props) => {
  const language = useLanguage()
  return (
    <Dialog title={language.t("marketplace.remove.title", { name: props.name })} fit>
      <div class="dialog-confirm-body">
        <span>
          {language.t("marketplace.remove.confirm", {
            type: kindLabel(language.t, props.record.kind),
            scope: language.t(`marketplace.scope.${props.record.scope}`),
          })}
        </span>
        <Show when={props.record.kind === "mcp"}>
          <span>{language.t("marketplace.remove.mcp.skills")}</span>
          <span>{language.t("marketplace.remove.keepsSignIn")}</span>
        </Show>
        <Show when={props.record.status === "modified"}>
          <span>{language.t("marketplace.card.modified")}</span>
        </Show>
        <div class="dialog-confirm-actions">
          <Button variant="secondary" onClick={props.onClose}>
            {language.t("marketplace.remove.cancel")}
          </Button>
          <Button variant="primary" class="danger-btn" onClick={props.onConfirm}>
            {language.t("marketplace.remove.confirm.button")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
