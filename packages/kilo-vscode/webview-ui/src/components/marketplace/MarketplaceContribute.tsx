import { Button } from "@kilocode/kilo-ui/button"
import { useLanguage } from "../../context/language"

const REPO_URL = "https://github.com/Kilo-Org/kilo-marketplace"

export const MarketplaceContribute = (props: { onOpen: (url: string) => void }) => {
  const language = useLanguage()
  return (
    <div class="marketplace-contribute">
      <span>{language.t("marketplace.contribute.prompt.v2")}</span>
      <Button variant="ghost" size="small" onClick={() => props.onOpen(REPO_URL)}>
        {language.t("marketplace.contribute.cta")}
      </Button>
    </div>
  )
}
