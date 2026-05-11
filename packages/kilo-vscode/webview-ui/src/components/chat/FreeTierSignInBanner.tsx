import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Show, type Component } from "solid-js"
import { useLanguage } from "../../context/language"
import { useNotifications } from "../../context/notifications"
import { useServer } from "../../context/server"

const BANNER_ID = "free-tier-signin-nudge"

export const FreeTierSignInBanner: Component = () => {
  const server = useServer()
  const notifications = useNotifications()
  const language = useLanguage()

  const signedOut = () => !server.profileData()
  const dismissed = () => notifications.dismissedIds().includes(BANNER_ID)
  // Wait until both auth state and dismissed-ids have loaded from the extension
  // host. Otherwise signed-in users briefly see the banner during webview boot,
  // and previously-dismissed banners flash back before notifications arrive.
  const ready = () => server.profileLoaded() && notifications.loaded()
  const visible = () => ready() && signedOut() && !dismissed()

  const signIn = () => server.goToLogin()
  const dismiss = () => notifications.dismiss(BANNER_ID)

  return (
    <Show when={visible()}>
      <div data-component="free-tier-signin-banner">
        <div data-slot="free-tier-signin-banner-copy">
          <span data-slot="free-tier-signin-banner-icon">
            <Icon name="brain" size="small" />
          </span>
          <span data-slot="free-tier-signin-banner-text">{language.t("chat.signInBanner.text")}</span>
        </div>
        <div data-slot="free-tier-signin-banner-actions">
          <Button variant="secondary" size="small" onClick={signIn}>
            {language.t("common.signIn")}
          </Button>
          <IconButton
            icon="close"
            variant="ghost"
            size="small"
            label={language.t("common.dismiss")}
            onClick={dismiss}
          />
        </div>
      </div>
    </Show>
  )
}
