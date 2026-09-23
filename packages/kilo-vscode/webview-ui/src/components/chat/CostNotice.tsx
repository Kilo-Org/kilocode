/**
 * Short, dismissible notice above the composer. Before a request, it warns
 * when a model or reasoning change will resend the context without cache.
 * After a request, it reports a request cost at or above the Request Cost
 * Notice threshold.
 */
import { Component, Show, createMemo, createSignal } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { useSession } from "../../context/session"
import { useProvider } from "../../context/provider"
import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import { cacheReset, noticeThreshold } from "../../context/cost-notice"

export const CostNotice: Component = () => {
  const session = useSession()
  const provider = useProvider()
  const { settings } = useConfig()
  const language = useLanguage()
  const [hidden, setHidden] = createSignal<string>()

  const money = (cost: number) =>
    new Intl.NumberFormat(language.locale(), { style: "currency", currency: "USD" }).format(cost)

  const reset = createMemo(() => {
    const id = session.currentSessionID()
    if (!id) return undefined
    const next = session.submission(id)
    const last = session.messages().findLast((msg) => msg.role === "user" && msg.model)?.model
    const found = cacheReset({
      last,
      next: next.model,
      variant: next.variant,
      tokens: session.contextUsage()?.tokens ?? 0,
      price: provider.findModel(next.model ?? null)?.cost?.input,
      threshold: noticeThreshold(settings().requestCostNotice),
    })
    if (!found) return undefined
    const key = `${id}|${next.model?.providerID}/${next.model?.modelID}|${next.variant ?? ""}`
    if (hidden() === key) return undefined
    const tokens = new Intl.NumberFormat(language.locale(), { notation: "compact" }).format(found.tokens)
    const vars = { tokens, cost: money(found.cost) }
    const text = language.t(found.kind === "model" ? "session.costNotice.model" : "session.costNotice.variant", vars)
    return { text, dismiss: () => setHidden(key) }
  })

  const notice = createMemo(() => {
    const item = session.costNotice()
    if (!item) return undefined
    const own = item.sessionID === session.currentSessionID()
    const key = own ? "session.costNotice.request" : "session.costNotice.subagent"
    return { text: language.t(key, { cost: money(item.cost) }), dismiss: () => session.dismissCostNotice(item.id) }
  })

  return (
    <Show when={reset() ?? notice()}>
      {(item) => (
        <div data-component="cost-notice" role="status">
          <Icon name="warning" size="small" data-slot="cost-notice-icon" />
          <span>{item().text}</span>
          <IconButton
            icon="close"
            size="small"
            variant="ghost"
            onClick={() => item().dismiss()}
            aria-label={language.t("session.costNotice.dismiss")}
          />
        </div>
      )}
    </Show>
  )
}
