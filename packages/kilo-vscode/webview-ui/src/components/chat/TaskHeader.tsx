/**
 * TaskHeader component
 * Sticky header above the chat messages showing session title,
 * cost, context usage, and a compact button.
 */

import { Component, Show, createMemo } from "solid-js"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useSession } from "../../context/session"
import { useLanguage } from "../../context/language"

export const TaskHeader: Component = () => {
  const session = useSession()
  const language = useLanguage()

  const title = createMemo(() => session.currentSession()?.title ?? language.t("command.session.new"))
  const hasMessages = createMemo(() => session.messages().length > 0)
  const busy = createMemo(() => session.status() === "busy")
  const canCompact = createMemo(() => !busy() && hasMessages() && !!session.selected())

  const cost = createMemo(() => {
    const total = session.totalCost()
    if (total === 0) return undefined
    return new Intl.NumberFormat(language.locale(), {
      style: "currency",
      currency: "USD",
    }).format(total)
  })

  const context = createMemo(() => {
    const usage = session.contextUsage()
    if (!usage) return undefined
    const tokens = usage.tokens.toLocaleString(language.locale())
    const pct = usage.percentage !== null ? `${usage.percentage}%` : undefined
    return { tokens, pct }
  })

  return (
    <Show when={hasMessages()}>
      <div data-component="task-header">
        <div data-slot="task-header-title" title={title()}>
          {title()}
        </div>
        <div data-slot="task-header-stats">
          <Show when={cost()}>
            {(c) => (
              <Tooltip value={language.t("context.usage.sessionCost")} placement="bottom">
                <span>{c()}</span>
              </Tooltip>
            )}
          </Show>
          <Show when={context()}>
            {(ctx) => (
              <Tooltip
                value={ctx().pct ? `${ctx().tokens} tokens (${ctx().pct} of context)` : `${ctx().tokens} tokens`}
                placement="bottom"
              >
                <span>{ctx().pct ?? ctx().tokens}</span>
              </Tooltip>
            )}
          </Show>
          <Tooltip value={language.t("command.session.compact")} placement="bottom">
            <IconButton
              icon="collapse"
              size="small"
              variant="ghost"
              disabled={!canCompact()}
              onClick={() => session.compact()}
              aria-label={language.t("command.session.compact")}
            />
          </Tooltip>
        </div>
      </div>
    </Show>
  )
}
