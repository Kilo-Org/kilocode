import { type Component, createEffect, createSignal, onCleanup, Show } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import type { PermissionRequest, QuestionRequest } from "../../types/messages"
import { useSession } from "../../context/session"
import { isEnterKeyCommitNotIme } from "../../utils/ime-enter"
import { MODE_SWITCH_TRANSITION_ICON, type ModeSwitchDetails } from "./mode-switch-ui"

const focusPrompt = () => requestAnimationFrame(() => window.dispatchEvent(new Event("focusPrompt")))

function Transition(props: { details: ModeSwitchDetails }) {
  return (
    <>
      <div data-slot="mode-switch-transition" aria-label={`${props.details.source} to ${props.details.target}`}>
        <span data-slot="mode-switch-mode">{props.details.source}</span>
        <Icon name={MODE_SWITCH_TRANSITION_ICON} size="small" />
        <span data-slot="mode-switch-mode" data-target>
          {props.details.target}
        </span>
      </div>
      <div data-slot="mode-switch-reason">
        <span data-slot="mode-switch-label">Reason</span>
        <span>{props.details.reason}</span>
      </div>
    </>
  )
}

export const ModeSwitchPermissionCard: Component<{
  request: PermissionRequest
  details: ModeSwitchDetails
  responding: boolean
  onDecide: (response: "once" | "reject", approvedAlways: string[], deniedAlways: string[]) => void
}> = (props) => {
  const [choice, setChoice] = createSignal<"switch" | "stay" | "always">()
  let root!: HTMLDivElement

  const pending = () => props.responding || choice() !== undefined

  const decide = (next: "switch" | "stay" | "always") => {
    if (pending()) return
    setChoice(next)
    if (next === "stay") props.onDecide("reject", [], [])
    else props.onDecide("once", next === "always" ? ["*"] : [], [])
    focusPrompt()
  }

  const control = (event: KeyboardEvent) =>
    event.target instanceof Element &&
    !!event.target.closest("button, input, select, textarea, a[href], [contenteditable='true']")

  const onKey = (event: KeyboardEvent) => {
    if (!document.hasFocus() || event.defaultPrevented || control(event)) return
    if (root.getClientRects().length === 0) return
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      decide("stay")
      return
    }
    if (isEnterKeyCommitNotIme(event) && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault()
      event.stopPropagation()
      decide("switch")
    }
  }

  createEffect(() => {
    void props.request.id
    document.addEventListener("keydown", onKey, true)
    onCleanup(() => document.removeEventListener("keydown", onKey, true))
  })

  return (
    <div
      ref={root}
      data-component="mode-switch-card"
      data-state={pending() ? "pending" : "request"}
      role="region"
      aria-labelledby={`mode-switch-title-${props.request.id}`}
    >
      <div data-slot="mode-switch-header">
        <Icon name={MODE_SWITCH_TRANSITION_ICON} size="small" />
        <span id={`mode-switch-title-${props.request.id}`}>Agent requests a mode change</span>
      </div>
      <Transition details={props.details} />
      <p data-slot="mode-switch-reassurance">Your task, files, and conversation continue unchanged.</p>
      <div data-slot="mode-switch-actions">
        <Button variant="primary" size="small" disabled={pending()} onClick={() => decide("switch")}>
          <Show when={pending() && choice() !== "stay"} fallback={`Switch to ${props.details.target}`}>
            Switching to {props.details.target}…
          </Show>
        </Button>
        <Button variant="ghost" size="small" disabled={pending()} onClick={() => decide("stay")}>
          Stay in {props.details.source}
        </Button>
        <Button variant="secondary" size="small" disabled={pending()} onClick={() => decide("always")}>
          Always allow agent mode changes
        </Button>
      </div>
      <div data-slot="mode-switch-live" role="status" aria-live="polite">
        <Show when={pending() && choice() !== "stay"}>Switching to {props.details.target}…</Show>
      </div>
    </div>
  )
}

export const ModeSwitchDeniedCard: Component<{
  request: QuestionRequest
  details: ModeSwitchDetails
}> = (props) => {
  const session = useSession()
  const [choice, setChoice] = createSignal<"continue" | "cancel">()
  let continueButton!: HTMLButtonElement

  const pending = () => choice() !== undefined

  createEffect(() => {
    if (!session.questionErrors().has(props.request.id)) return
    setChoice(undefined)
  })

  createEffect(() => {
    requestAnimationFrame(() => {
      if (!document.hasFocus()) return
      continueButton?.focus({ preventScroll: true })
    })
  })

  const reply = (next: "continue" | "cancel") => {
    if (pending()) return
    setChoice(next)
    session.replyToQuestion(props.request.id, [[next === "continue" ? "Continue current mode" : "Cancel task"]])
    focusPrompt()
  }

  return (
    <div
      data-component="mode-switch-card"
      data-state="denied"
      role="region"
      aria-labelledby={`mode-switch-denied-title-${props.request.id}`}
    >
      <div data-slot="mode-switch-header">
        <Icon name="circle-ban-sign" size="small" />
        <span id={`mode-switch-denied-title-${props.request.id}`}>Mode change blocked</span>
      </div>
      <Transition details={props.details} />
      <p data-slot="mode-switch-reassurance">The task is paused. Continue in {props.details.source}, or cancel it.</p>
      <div data-slot="mode-switch-actions">
        <Button
          ref={continueButton}
          variant="primary"
          size="small"
          disabled={pending()}
          onClick={() => reply("continue")}
        >
          <Show when={choice() === "continue"} fallback={`Continue in ${props.details.source}`}>
            Continuing in {props.details.source}…
          </Show>
        </Button>
        <Button
          class="mode-switch-cancel"
          variant="ghost"
          size="small"
          disabled={pending()}
          onClick={() => reply("cancel")}
        >
          <Show when={choice() === "cancel"} fallback="Cancel task">
            Cancelling task…
          </Show>
        </Button>
      </div>
      <div data-slot="mode-switch-live" role="status" aria-live="polite">
        <Show when={choice() === "continue"}>Continuing in {props.details.source}…</Show>
        <Show when={choice() === "cancel"}>Cancelling task…</Show>
      </div>
    </div>
  )
}
