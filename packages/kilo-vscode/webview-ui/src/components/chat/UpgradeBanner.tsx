/**
 * UpgradeBanner
 * Shown when the backend API signals that the user's extension version
 * is too old and must be upgraded (HTTP 426 / UPGRADE_REQUIRED error code).
 *
 * Two display modes:
 *  - **banner** (default): persistent top-of-chat banner with update button.
 *  - **inline**: per-message card rendered inside ErrorDisplay.
 */

import { Component, Show } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Button } from "@kilocode/kilo-ui/button"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"

const MARKETPLACE_URL = "vscode:extension/kilocode.kilo-code"

interface UpgradeBannerProps {
  /** When true, render a compact inline card instead of a full-width banner. */
  inline?: boolean
}

export const UpgradeBanner: Component<UpgradeBannerProps> = (props) => {
  const { t } = useLanguage()
  const vscode = useVSCode()

  const update = () => {
    vscode.postMessage({ type: "openExternal", url: MARKETPLACE_URL })
  }

  return (
    <div class={props.inline ? "upgrade-banner upgrade-banner--inline" : "upgrade-banner"} role="alert">
      <div class="upgrade-banner-content">
        <div class="upgrade-banner-header">
          <Icon name="warning" size="small" />
          <span class="upgrade-banner-title">{t("error.upgradeRequired.title")}</span>
        </div>
        <p class="upgrade-banner-description">{t("error.upgradeRequired.description")}</p>
        <Show when={!props.inline}>
          <p class="upgrade-banner-legacy">{t("error.upgradeRequired.legacy")}</p>
        </Show>
      </div>
      <div class="upgrade-banner-actions">
        <Button variant="primary" size="small" onClick={update}>
          {t("error.upgradeRequired.action")}
        </Button>
      </div>
    </div>
  )
}
