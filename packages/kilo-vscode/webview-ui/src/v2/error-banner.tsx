import { Icon } from "@kilocode/kilo-ui/icon"
import type { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { createEffect, createSignal, on, Show, type Accessor } from "solid-js"
import { useLanguage } from "../context/language"
import { failureText, type Failure } from "./error"
import { catalogAuthFailure, failureNeedsSignIn } from "./kilo-catalog"

export interface ErrorBannerAction {
  readonly label: string
  readonly onClick: () => void
}

/**
 * The failure banner above the composer. It names what happened in a sentence, keeps the technical
 * text behind a details disclosure, and can offer a recovery action or be dismissed while its cause
 * is being resolved.
 */
export function ErrorBanner(props: { failure: Failure; action?: ErrorBannerAction; onDismiss?: () => void }) {
  const language = useLanguage()
  const [expanded, setExpanded] = createSignal(false)
  const message = () => failureText(props.failure, language.t)
  return (
    <div class="startup-error-banner" role="alert" data-component="v2-error">
      <div class="startup-error-header">
        <Show when={props.failure.details} fallback={<span class="startup-error-message">{message()}</span>}>
          <button
            type="button"
            class="startup-error-toggle"
            aria-expanded={expanded()}
            onClick={() => setExpanded((open) => !open)}
          >
            <span
              classList={{ "startup-error-chevron": true, "startup-error-chevron-expanded": expanded() }}
              aria-hidden="true"
            >
              <Icon name="chevron-right" size="small" />
            </span>
            <span class="startup-error-message">{message()}</span>
          </button>
        </Show>
        <Show when={props.action || props.onDismiss}>
          <div class="startup-error-actions">
            <Show when={props.action}>
              {(action) => (
                <button type="button" class="startup-error-action" onClick={() => action().onClick()}>
                  {action().label}
                </button>
              )}
            </Show>
            <Show when={props.onDismiss}>
              <button type="button" class="startup-error-dismiss" onClick={() => props.onDismiss?.()}>
                {language.t("common.dismiss")}
              </button>
            </Show>
          </div>
        </Show>
      </div>
      <Show when={expanded() ? props.failure.details : undefined}>
        {(details) => (
          <pre class="startup-error-details" data-scrollable>
            {details()}
          </pre>
        )}
      </Show>
    </div>
  )
}

/**
 * Resolves the single composer banner across handshake, directory failure, inbox refresh, and Kilo
 * Gateway auth failures, attaching a Sign-In action whenever signing in can recover the failure.
 */
export function createBannerState(input: {
  handshake: Accessor<Failure | undefined>
  failure: Accessor<Failure | undefined>
  clearError: () => void
  inbox: Accessor<Failure | undefined>
  dismissInbox: () => void
  kiloFailure: Accessor<KiloGatewayRpc.CatalogFailure | undefined>
  signInLabel: Accessor<string>
  onSignIn: () => void
}): Accessor<{ failure: Failure; action?: ErrorBannerAction; onDismiss?: () => void } | undefined> {
  const [dismissedCatalog, setDismissedCatalog] = createSignal<KiloGatewayRpc.CatalogFailure>()
  // Clear a prior dismissal whenever the catalog failure resolves or changes to a different reason.
  createEffect(
    on(input.kiloFailure, (next, prev) => {
      if (!next || !sameCatalogFailure(next, prev)) setDismissedCatalog(undefined)
    }),
  )
  return () => {
    const handshake = input.handshake()
    if (handshake) return { failure: handshake }
    const kilo = input.kiloFailure()
    const signIn = () => ({ label: input.signInLabel(), onClick: input.onSignIn })
    const error = input.failure()
    if (error) {
      const needsSignIn = error.auth === true || (!!kilo && failureNeedsSignIn(kilo))
      return { failure: error, onDismiss: input.clearError, action: needsSignIn ? signIn() : undefined }
    }
    const pending = input.inbox()
    if (pending) return { failure: pending, onDismiss: input.dismissInbox, action: pending.auth ? signIn() : undefined }
    if (!kilo || sameCatalogFailure(kilo, dismissedCatalog())) return undefined
    const auth = catalogAuthFailure(kilo)
    if (!auth) return undefined
    return { failure: auth, onDismiss: () => setDismissedCatalog(kilo), action: signIn() }
  }
}

function sameCatalogFailure(
  left: KiloGatewayRpc.CatalogFailure | undefined,
  right: KiloGatewayRpc.CatalogFailure | undefined,
) {
  if (!left || !right) return false
  return left.kind === right.kind && left.status === right.status
}
