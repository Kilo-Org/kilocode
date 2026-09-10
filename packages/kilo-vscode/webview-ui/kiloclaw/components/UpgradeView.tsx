// KiloClaw upgrade view — shown when instance needs upgrade for chat

import { Button } from "@kilocode/kilo-ui/button"
import { Card, CardTitle, CardDescription, CardActions } from "@kilocode/kilo-ui/card"
import { useClaw } from "../context/claw"
import { useKiloClawLanguage } from "../context/language"

export function UpgradeView() {
  const claw = useClaw()
  const { t } = useKiloClawLanguage()

  return (
    <div class="kiloclaw-center">
      <Card class="kiloclaw-card">
        <CardTitle icon={false}>{t("kiloClaw.upgrade.title")}</CardTitle>
        <CardDescription>
          <p class="kiloclaw-card-text">{t("kiloClaw.upgrade.description1")}</p>
          <p class="kiloclaw-card-text">
            {t("kiloClaw.upgrade.description2.before")}
            <strong>{t("kiloClaw.upgrade.description2.bold")}</strong>
            {t("kiloClaw.upgrade.description2.after")}
          </p>
        </CardDescription>
        <CardActions>
          <div />
          <Button variant="primary" onClick={() => claw.openExternal("https://app.kilo.ai/claw")}>
            {t("kiloClaw.upgrade.openDashboard")}
          </Button>
        </CardActions>
      </Card>
    </div>
  )
}
