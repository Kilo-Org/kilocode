import { Card } from "@kilocode/kilo-ui/card"
import { type Component, Show, createMemo } from "solid-js"
import { useSession } from "../../context/session"
import { terminal, type TerminalState } from "../../context/session-outcome"
import { useLanguage } from "../../context/language"

export const TurnOutcome: Component = () => {
  const session = useSession()
  const language = useLanguage()
  const state = createMemo(() =>
    terminal({
      reason: session.closeReason(),
      messages: session.visibleMessages(),
      todos: session.todos(),
      hidden: session.isErrorHidden,
    }),
  )

  const label = (value: TerminalState) => {
    if (value.kind === "interrupted") return language.t("session.outcome.interrupted")
    if (value.kind === "error") return language.t("session.outcome.error")
    if (value.kind === "limit") return language.t("session.outcome.limit")
    if (value.kind === "unknown") return language.t("session.outcome.unknown")
    if (value.kind === "filtered") return language.t("session.outcome.filtered")
    if (value.kind === "unexpected") return language.t("session.outcome.unexpected")
    return language.t("session.outcome.incomplete", { count: String(value.remaining) })
  }

  return (
    <Show when={session.status() === "idle" && state()}>
      {(value) => (
        <div
          class="vscode-session-turn"
          role="status"
          title={value().finish ? language.t("session.outcome.finish", { reason: value().finish! }) : undefined}
        >
          <Card variant={value().tone === "critical" ? "error" : "warning"}>
            <div>{label(value())}</div>
            <Show when={value().kind === "unknown" && value().vercelID}>{(id) => <code>Request ID: {id()}</code>}</Show>
          </Card>
        </div>
      )}
    </Show>
  )
}
