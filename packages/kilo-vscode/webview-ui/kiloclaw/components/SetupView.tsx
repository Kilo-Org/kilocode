// KiloClaw setup view — shown when no instance is provisioned

import { Button } from "@kilocode/kilo-ui/button"
import { Card, CardTitle, CardDescription, CardActions } from "@kilocode/kilo-ui/card"
import { useClaw } from "../context/claw"
import { useKiloClawLanguage } from "../context/language"

export function SetupView() {
  const claw = useClaw()
  const { t } = useKiloClawLanguage()

  return (
    <div class="kiloclaw-center">
      <Card class="kiloclaw-card">
        <CardTitle icon={false}>{t("kiloClaw.setup.title")}</CardTitle>
        <CardDescription>
          <h3 class="kiloclaw-card-subtitle">{t("kiloClaw.setup.subtitle")}</h3>
          <p class="kiloclaw-card-text">{t("kiloClaw.setup.description1")}</p>
          <p class="kiloclaw-card-text">{t("kiloClaw.setup.description2")}</p>
        </CardDescription>
        <CardActions>
          <Button variant="ghost" onClick={() => claw.openExternal("https://kilo.ai/kiloclaw")}>
            {t("kiloClaw.setup.learnMore")}
          </Button>
          <Button variant="primary" onClick={() => claw.openExternal("https://app.kilo.ai/claw")}>
            {t("kiloClaw.setup.tryKiloClaw")}
          </Button>
        </CardActions>
      </Card>
    </div>
  )
}
