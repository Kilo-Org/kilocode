import { Button } from "@kilocode/kilo-ui/button"
import { useVSCode } from "../../context/vscode"
import { useLanguage } from "../../context/language"

const REPO_URL = "https://github.com/Kilo-Org/kilo-marketplace"

export const MarketplaceContribute = () => {
  const vscode = useVSCode()
  const { t } = useLanguage()
  const open = () => vscode.postMessage({ type: "openExternal", url: REPO_URL })
  return (
    <div class="marketplace-contribute">
      <span>{t("marketplace.contribute.prompt")}</span>
      <Button variant="ghost" size="small" onClick={open}>
        {t("marketplace.contribute.cta")}
      </Button>
    </div>
  )
}
