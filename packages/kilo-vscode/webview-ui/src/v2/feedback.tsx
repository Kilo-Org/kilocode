// The Feedback & Support dialog. Links open through the V2 scope, which asks the host to reject non-web URLs.
import { Button } from "@kilocode/kilo-ui/button"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { Icon } from "@kilocode/kilo-ui/icon"
import type { JSX } from "solid-js"
import { useLanguage } from "../context/language"
import { useV2 } from "./client"

const GITHUB_ISSUES_URL = "https://github.com/Kilo-Org/kilocode/issues/new/choose"
const DISCORD_URL = "https://kilo.ai/discord"
const SUPPORT_URL = "https://kilo.ai/support"

const KiloLogo = (): JSX.Element => {
  const iconsBaseUri = (window as { ICONS_BASE_URI?: string }).ICONS_BASE_URI || ""
  const isLight =
    document.body.classList.contains("vscode-light") || document.body.classList.contains("vscode-high-contrast-light")
  const iconFile = isLight ? "kilo-light.svg" : "kilo-dark.svg"

  return (
    <div class="feedback-dialog-logo">
      <img src={`${iconsBaseUri}/${iconFile}`} alt="Kilo Code" />
    </div>
  )
}

export function FeedbackDialog() {
  const v2 = useV2()
  const language = useLanguage()
  const dialog = useDialog()

  const open = (url: string) => {
    v2.open(url)
    dialog.close()
  }

  return (
    <Dialog title="" fit>
      <div class="feedback-dialog">
        <KiloLogo />
        <p class="feedback-dialog-message">{language.t("feedback.dialog.message")}</p>
        <div class="feedback-dialog-actions">
          <Button variant="primary" size="large" data-full-width="true" onClick={() => open(GITHUB_ISSUES_URL)}>
            <Icon name="github" size="small" />
            {language.t("feedback.dialog.github")}
          </Button>
          <Button variant="secondary" size="large" data-full-width="true" onClick={() => open(DISCORD_URL)}>
            <Icon name="discord" size="small" />
            {language.t("feedback.dialog.discord")}
          </Button>
          <Button variant="secondary" size="large" data-full-width="true" onClick={() => open(SUPPORT_URL)}>
            <Icon name="help" size="small" />
            {language.t("feedback.dialog.support")}
          </Button>
        </div>
        <Button variant="ghost" size="small" onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </Button>
      </div>
    </Dialog>
  )
}
