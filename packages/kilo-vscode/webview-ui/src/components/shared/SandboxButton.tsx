/** Shared sandbox lock control used by the chat prompt and Agent Manager. */

import { type Component, type JSX } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { Icon } from "@kilocode/kilo-ui/icon"
import { useLanguage } from "../../context/language"

export interface SandboxButtonBaseProps {
  enabled: boolean
  available?: boolean
  reason?: string
  disabled?: boolean
  tooltip?: JSX.Element
  tooltipClass?: string
  onToggle: () => void
}

export const SandboxTooltipContent: Component<{ enabled: boolean; network: boolean }> = (props) => {
  const language = useLanguage()

  return (
    <div class="prompt-sandbox-tooltip">
      <div class="prompt-sandbox-tooltip-title">
        {language.t(props.enabled ? "prompt.action.sandbox.status.enabled" : "prompt.action.sandbox.status.disabled")}
      </div>
      <div class="prompt-sandbox-tooltip-row">
        <Icon name="folder" size="small" />
        <span>{language.t("prompt.action.sandbox.filesystem")}</span>
        <span class="prompt-sandbox-tooltip-state">
          {language.t(
            props.enabled ? "prompt.action.sandbox.filesystem.restricted" : "prompt.action.sandbox.unrestricted",
          )}
        </span>
      </div>
      <div class="prompt-sandbox-tooltip-row">
        <Icon name="globe" size="small" />
        <span>{language.t("prompt.action.sandbox.network")}</span>
        <span class="prompt-sandbox-tooltip-state">
          {language.t(
            props.enabled && props.network
              ? "prompt.action.sandbox.network.blocked"
              : props.enabled
                ? "prompt.action.sandbox.network.allowed"
                : "prompt.action.sandbox.unrestricted",
          )}
        </span>
      </div>
      <div class="prompt-sandbox-tooltip-description">
        {language.t(
          props.enabled
            ? "prompt.action.sandbox.description.enabled"
            : props.network
              ? "prompt.action.sandbox.description.disabled"
              : "prompt.action.sandbox.description.disabledNetworkAllowed",
        )}
      </div>
    </div>
  )
}

export const SandboxButtonBase: Component<SandboxButtonBaseProps> = (props) => {
  const language = useLanguage()
  const unavailable = () => props.available === false
  const tooltip = () =>
    unavailable()
      ? (props.reason ?? language.t("common.requestFailed"))
      : (props.tooltip ??
        language.t(props.enabled ? "prompt.action.sandbox.enabled" : "prompt.action.sandbox.disabled"))

  return (
    <Tooltip
      value={tooltip()}
      contentClass={unavailable() ? undefined : props.tooltipClass}
      placement="top"
      openDelay={0}
    >
      <Button
        variant="ghost"
        size="small"
        onClick={props.onToggle}
        disabled={props.disabled || unavailable()}
        aria-label={
          props.enabled ? language.t("prompt.action.sandbox.disable") : language.t("prompt.action.sandbox.enable")
        }
        aria-pressed={props.enabled}
        class={`prompt-status-button ${props.enabled ? "prompt-status-button--active" : ""}`}
      >
        <Icon name="lock" size="small" />
      </Button>
    </Tooltip>
  )
}
