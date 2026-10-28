/**
 * WorkingIndicator component
 * Shows a spinner, status text, and elapsed time counter while the agent is active.
 *
 * Main's component on native v2 session data. The label falls back to the "thinking" text because v2 exposes only the
 * session status, not a live status text, and the retry countdown comes from the scheduled retry the assistant row
 * carries. Markup, classes and timing match v1, so the label shimmer, the swap and the elapsed fade animate as there.
 */

import { Button } from "@kilocode/kilo-ui/button"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show } from "solid-js"
import { useLanguage } from "../../context/language"
import { useV2 } from "../../v2/client"
import { StatusText } from "./StatusText"

/** The retry state of the running turn, from the assistant message's `session.retry.scheduled` data. */
export type Retry = { attempt: number; at: number; error: { message: string } }

export const WorkingIndicator = (props: { session: string; retry?: Retry; onScrollToBottom?: () => void }) => {
  const v2 = useV2()
  const language = useLanguage()
  const [elapsed, setElapsed] = createSignal(0)
  const [retryCountdown, setRetryCountdown] = createSignal(0)

  // The indicator mounts when the turn starts, so the counter runs from the first tick. A session change restarts it.
  createEffect(
    on(
      () => props.session,
      () => setElapsed(0),
    ),
  )
  onMount(() => {
    const id = setInterval(() => setElapsed((value) => value + 1), 1000)
    onCleanup(() => clearInterval(id))
  })

  createEffect(
    on(
      () => props.retry,
      (retry) => {
        if (!retry) {
          setRetryCountdown(0)
          return
        }
        const target = retry.at
        const tick = () => setRetryCountdown(Math.max(0, Math.ceil((target - Date.now()) / 1000)))
        tick()
        const id = setInterval(() => {
          const remaining = Math.max(0, Math.ceil((target - Date.now()) / 1000))
          setRetryCountdown(remaining)
          if (remaining <= 0) clearInterval(id)
        }, 1000)
        onCleanup(() => clearInterval(id))
      },
    ),
  )

  // Memoized so a value equal to the previous one never reaches `StatusText` on a re-render, which would replay the
  // swap animation. Only a real change (the turn starts or stops retrying) swaps the label.
  const statusText = createMemo(() => {
    const retry = props.retry
    if (retry) return retry.error.message || language.t("session.status.retry")
    return language.t("ui.sessionTurn.status.thinking")
  })

  const isRetrying = () => !!props.retry

  const formatElapsed = () => {
    const s = elapsed()
    if (s < 60) return `${s}s`
    const m = Math.floor(s / 60)
    const rem = s % 60
    return `${m}m ${rem}s`
  }

  const cancelRetry = () => {
    void v2.api.session.interrupt({ sessionID: props.session }).catch(v2.report)
  }

  return (
    <div class="working-indicator">
      <Button variant="ghost" size="small" class="working-indicator-scroll" onClick={() => props.onScrollToBottom?.()}>
        <Spinner />
        <StatusText text={statusText()} />
        {/* Kept out of the label: a countdown inside the morphing text would swap it
            once a second, and every tick would read as a new status. */}
        <Show when={isRetrying() && retryCountdown() > 0}>
          <span class="working-count">({retryCountdown()}s)</span>
        </Show>
        {/* Laid out for the whole turn and only faded until the first tick: mounting
            the counter a second in shifted the whole cluster sideways. */}
        <span class="working-elapsed" data-empty={elapsed() > 0 ? undefined : ""}>
          {formatElapsed()}
        </span>
        <span class="sr-only">{language.t("session.messages.scrollToBottom")}</span>
      </Button>
      <Show when={isRetrying()}>
        <Button
          variant="secondary"
          size="small"
          onClick={cancelRetry}
          class="working-cancel"
          style={{ "font-weight": "600", color: "var(--vscode-errorForeground, #f85149)" }}
        >
          {language.t("ui.sessionTurn.cancel") || "Cancel"}
        </Button>
      </Show>
    </div>
  )
}
