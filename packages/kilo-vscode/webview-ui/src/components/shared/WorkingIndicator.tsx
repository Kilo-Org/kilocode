/**
 * WorkingIndicator component
 * Shows a spinner, status text, and elapsed time counter while the agent is active.
 * Matches the v1.0.25 working indicator UX.
 *
 * Purely visual: `SessionDock` decides when this renders (see `showsWorking`).
 * Keeping the decision in one place is what stops the dock from resizing when
 * a turn starts or ends.
 */

import { type Component, Show, createSignal, createEffect, createMemo, onCleanup } from "solid-js"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { Button } from "@kilocode/kilo-ui/button"
import { useSession } from "../../context/session"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import { StatusText } from "./StatusText"
import { tracksElapsed } from "./working-indicator-utils"

export const WorkingIndicator: Component = () => {
  const session = useSession()
  const language = useLanguage()
  const vscode = useVSCode()

  const [elapsed, setElapsed] = createSignal(0)
  const [retryCountdown, setRetryCountdown] = createSignal(0)

  createEffect(() => {
    const since = session.busySince()
    const status = session.status()

    if (!tracksElapsed(status, session.submitting(), since)) {
      setElapsed(0)
      return
    }

    setElapsed(Math.floor((Date.now() - since) / 1000))

    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - since) / 1000))
    }, 1000)

    onCleanup(() => clearInterval(id))
  })

  createEffect(() => {
    const info = session.statusInfo()
    if (info.type !== "retry") {
      setRetryCountdown(0)
      return
    }

    const target = info.next
    setRetryCountdown(Math.max(0, Math.ceil((target - Date.now()) / 1000)))

    const id = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((target - Date.now()) / 1000))
      setRetryCountdown(remaining)
      if (remaining <= 0) clearInterval(id)
    }, 1000)

    onCleanup(() => clearInterval(id))
  })

  // Memoized so an unchanged label never reaches `StatusText`: the status is
  // recomputed on every streamed part, and each pass through would otherwise
  // replay the swap animation.
  const statusText = createMemo(() => {
    const info = session.statusInfo()
    if (info.type === "retry") return info.message || language.t("session.status.retry")
    if (info.type === "offline") return info.message || language.t("session.status.offline")
    return session.statusText() ?? language.t("ui.sessionTurn.status.thinking")
  })

  const formatElapsed = () => {
    const s = elapsed()
    if (s < 60) return `${s}s`
    const m = Math.floor(s / 60)
    const rem = s % 60
    return `${m}m ${rem}s`
  }

  const isRetrying = () => session.statusInfo().type === "retry"

  // The counter's slot is reserved for exactly as long as the turn is timed, so a
  // state that never counts (a retry with no start time) keeps the row compact.
  const timing = () => tracksElapsed(session.status(), session.submitting(), session.busySince())

  const handleCancelRetry = () => {
    const sid = session.currentSessionID()
    if (sid) {
      vscode.postMessage({ type: "abort", sessionID: sid, scope: "session" })
    }
  }

  return (
    <div class="working-indicator">
      <Spinner />
      <StatusText text={statusText()} />
      {/* Kept out of the label: a countdown inside the morphing text would swap it
          once a second, and every tick would read as a new status. */}
      <Show when={isRetrying() && retryCountdown() > 0}>
        <span class="working-count">({retryCountdown()}s)</span>
      </Show>
      {/* Laid out for the whole turn and only faded until the first tick: mounting
          the counter a second in shifted the whole cluster sideways. */}
      <Show when={timing()}>
        <span class="working-elapsed" data-empty={elapsed() > 0 ? undefined : ""}>
          {formatElapsed()}
        </span>
      </Show>
      <Show when={isRetrying()}>
        <Button
          variant="secondary"
          size="small"
          onClick={handleCancelRetry}
          class="working-cancel"
          style={{ "font-weight": "600", color: "var(--vscode-errorForeground, #f85149)" }}
        >
          {language.t("ui.sessionTurn.cancel") || "Cancel"}
        </Button>
      </Show>
    </div>
  )
}
