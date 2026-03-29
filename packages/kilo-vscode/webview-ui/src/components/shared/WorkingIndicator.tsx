/**
 * WorkingIndicator component
 * Shows a spinner, status text, and elapsed time counter while the agent is active.
 * Matches the v1.0.25 working indicator UX.
 */

import { Component, Show, createSignal, createEffect, onCleanup } from "solid-js"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { Button } from "@kilocode/kilo-ui/button"
import { useSession } from "../../context/session"
import { useLanguage } from "../../context/language"

export const WorkingIndicator: Component = () => {
  const session = useSession()
  const language = useLanguage()

  const [elapsed, setElapsed] = createSignal(0)
  const [retryCountdown, setRetryCountdown] = createSignal(0)
  const [continued, setContinued] = createSignal<Record<string, boolean>>({})

  const mark = () => {
    const id = session.currentSessionID()
    if (!id) return
    setContinued((map) => ({ ...map, [id]: true }))
  }

  createEffect(() => {
    const since = session.busySince()
    const status = session.status()
    const id = session.currentSessionID()

    if (!id || status === "idle" || !since) {
      if (id && continued()[id]) {
        setContinued((map) => {
          const next = { ...map }
          delete next[id]
          return next
        })
      }
      setElapsed(0)
      return
    }

    setElapsed(Math.floor((Date.now() - since) / 1000))

    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - since) / 1000))
    }, 1000)

    onCleanup(() => clearInterval(timer))
  })

  createEffect(() => {
    const info = session.statusInfo()
    if (info.type !== "retry") {
      setRetryCountdown(0)
      return
    }

    const target = info.next
    setRetryCountdown(Math.max(0, Math.ceil((target - Date.now()) / 1000)))

    const timer = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((target - Date.now()) / 1000))
      setRetryCountdown(remaining)
      if (remaining <= 0) clearInterval(timer)
    }, 1000)

    onCleanup(() => clearInterval(timer))
  })

  const statusText = () => {
    const info = session.statusInfo()
    if (info.type === "retry") {
      const countdown = retryCountdown()
      const retryMsg = info.message || language.t("session.status.retry")
      return countdown > 0 ? `${retryMsg} (${countdown}s)` : retryMsg
    }
    return session.statusText() ?? language.t("ui.sessionTurn.status.thinking")
  }

  const formatElapsed = () => {
    const s = elapsed()
    if (s < 60) return `${s}s`
    const m = Math.floor(s / 60)
    const rem = s % 60
    return `${m}m ${rem}s`
  }

  const blocked = () => {
    const id = session.currentSessionID()
    const perms = session
      .permissions()
      .filter((p) => p.sessionID === id && !(p.tool && ["todowrite", "todoread"].includes(p.toolName)))
    const questions = session.questions().filter((q) => q.sessionID === id)
    return perms.length > 0 || questions.length > 0
  }

  const long = () => {
    const id = session.currentSessionID()
    if (!id || continued()[id]) return false
    return session.status() !== "idle" && elapsed() >= 15
  }

  return (
    <Show when={session.status() !== "idle" && !blocked()}>
      <div class="working-indicator">
        <Spinner />
        <span class="working-text">{statusText()}</span>
        <Show when={elapsed() > 0}>
          <span class="working-elapsed">{formatElapsed()}</span>
        </Show>
        <Show when={long()}>
          <div class="working-actions">
            <Button size="small" variant="ghost" onClick={mark}>
              {language.t("migration.whatsNew.continue")}
            </Button>
            <Button size="small" variant="ghost" onClick={() => session.abort()}>
              {language.t("prompt.action.stop")}
            </Button>
          </div>
        </Show>
      </div>
    </Show>
  )
}
