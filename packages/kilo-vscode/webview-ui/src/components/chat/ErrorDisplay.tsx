import { Component, createMemo, Switch, Match } from "solid-js"
import { Card } from "@kilocode/kilo-ui/card"
import { Collapsible } from "@kilocode/kilo-ui/collapsible"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { ErrorDetails } from "@kilocode/kilo-ui/error-details"
import { Button } from "@kilocode/kilo-ui/button"
import type { AssistantMessage } from "@kilocode/sdk/v2"
import { useLanguage } from "../../context/language"
import { useProvider } from "../../context/provider"
import {
  unwrapError,
  parseAssistantError,
  parseProviderAuthError,
  isUnauthorizedPaidModelError,
  isUnauthorizedPromotionLimitError,
} from "../../utils/errorUtils"
import ProviderConnectDialog from "../settings/ProviderConnectDialog"

export interface ErrorDisplayProps {
  error: NonNullable<AssistantMessage["error"]>
  onLogin?: () => void
}

export const ErrorDisplay: Component<ErrorDisplayProps> = (props) => {
  const { t } = useLanguage()
  const dialog = useDialog()
  const provider = useProvider()
  const parsed = createMemo(() => parseAssistantError(props.error))
  const auth = createMemo(() => parseProviderAuthError(props.error))
  const authProvider = createMemo(() => {
    const err = auth()
    if (!err) return
    return provider.providers()[err.providerID]
  })
  const canAuth = createMemo(() => {
    const err = auth()
    if (!err || !authProvider()) return false
    return (provider.authMethods()[err.providerID] ?? []).length > 0
  })
  const oauth = createMemo(() => {
    const err = auth()
    if (!err) return false
    return (
      err.providerID === "openai" &&
      (provider.authMethods()[err.providerID] ?? []).some((method) => method.type === "oauth")
    )
  })

  const errorText = createMemo(() => {
    const msg = props.error.data?.message
    if (typeof msg === "string") return unwrapError(msg)
    if (msg === undefined || msg === null) return ""
    return unwrapError(String(msg))
  })

  function connectProvider() {
    const err = auth()
    if (!err) return
    dialog.show(() => <ProviderConnectDialog providerID={err.providerID} oauthOnly={oauth()} />)
  }

  return (
    <Switch
      fallback={
        <Card variant="error" class="error-card">
          {errorText()}
          <Collapsible variant="ghost">
            <Collapsible.Trigger class="error-details-trigger">
              <span>{t("error.details.show")}</span>
              <Collapsible.Arrow />
            </Collapsible.Trigger>
            <Collapsible.Content>
              <ErrorDetails error={props.error} />
            </Collapsible.Content>
          </Collapsible>
        </Card>
      }
    >
      <Match when={isUnauthorizedPaidModelError(parsed())}>
        <div data-component="auth-prompt">
          <div data-slot="auth-prompt-header">
            <span data-slot="auth-prompt-icon">✨</span>
            <span data-slot="auth-prompt-title">{t("error.paidModel.title")}</span>
          </div>
          <p data-slot="auth-prompt-description">{t("error.paidModel.description")}</p>
          <Button variant="primary" onClick={() => props.onLogin?.()}>
            {t("error.paidModel.action")}
          </Button>
        </div>
      </Match>
      <Match when={isUnauthorizedPromotionLimitError(parsed())}>
        <div data-component="auth-prompt">
          <div data-slot="auth-prompt-header">
            <span data-slot="auth-prompt-icon">🕙</span>
            <span data-slot="auth-prompt-title">{t("error.promotionLimit.title")}</span>
          </div>
          <p data-slot="auth-prompt-description">{t("error.promotionLimit.description")}</p>
          <Button variant="primary" onClick={() => props.onLogin?.()}>
            {t("error.promotionLimit.action")}
          </Button>
        </div>
      </Match>
      <Match when={canAuth()}>
        <div data-component="auth-prompt">
          <div data-slot="auth-prompt-header">
            <span data-slot="auth-prompt-icon">↻</span>
            <span data-slot="auth-prompt-title">
              {oauth()
                ? t("error.providerAuth.chatgpt.title")
                : t("error.providerAuth.title", { provider: authProvider()?.name ?? auth()?.providerID ?? "provider" })}
            </span>
          </div>
          <p data-slot="auth-prompt-description">
            {oauth()
              ? t("error.providerAuth.chatgpt.description")
              : t("error.providerAuth.description", {
                  provider: authProvider()?.name ?? auth()?.providerID ?? "provider",
                })}
          </p>
          <Button variant="primary" onClick={connectProvider}>
            {oauth() ? t("settings.providers.action.signInChatGPT") : t("common.connect")}
          </Button>
        </div>
      </Match>
    </Switch>
  )
}
