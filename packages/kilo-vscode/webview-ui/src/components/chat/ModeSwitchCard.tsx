import { type Component, createEffect, createSignal, onCleanup, Show } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import type { PermissionRequest } from "../../types/messages"
import { useLanguage } from "../../context/language"
import { isEnterKeyCommitNotIme } from "../../utils/ime-enter"
import { MODE_SWITCH_TRANSITION_ICON, type ModeSwitchDetails } from "./mode-switch-ui"

const focusPrompt = () => requestAnimationFrame(() => window.dispatchEvent(new Event("focusPrompt")))

function Transition(props: { details: ModeSwitchDetails }) {
  const language = useLanguage()
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
        <span data-slot="mode-switch-label">{language.t("ui.permission.modeSwitch.reason")}</span>
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
  const [choice, setChoice] = createSignal<"switch" | "stay">()
  let root!: HTMLDivElement
  const language = useLanguage()

  const pending = () => props.responding || choice() !== undefined

  const decide = (next: "switch" | "stay") => {
    if (pending()) return
    setChoice(next)
    if (next === "stay") props.onDecide("reject", [], [])
    else props.onDecide("once", [], [])
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
        <span id={`mode-switch-title-${props.request.id}`}>{language.t("ui.permission.modeSwitch.heading")}</span>
      </div>
      <Transition details={props.details} />
      <p data-slot="mode-switch-reassurance">{language.t("ui.permission.modeSwitch.reassurance")}</p>
      <span class="sr-only" data-slot="mode-switch-aria-prompt">
        {language.t("ui.permission.modeSwitch.prompt", {
          source: props.details.source,
          target: props.details.target,
          reason: props.details.reason,
        })}
      </span>
      <div data-slot="mode-switch-actions">
        <Button variant="primary" size="small" disabled={pending()} onClick={() => decide("switch")}>
          <Show
            when={pending() && choice() !== "stay"}
            fallback={language.t("ui.permission.modeSwitch.switch", { target: props.details.target })}
          >
            {language.t("ui.permission.modeSwitch.switching", { target: props.details.target })}
          </Show>
        </Button>
        <Button variant="ghost" size="small" disabled={pending()} onClick={() => decide("stay")}>
          {language.t("ui.permission.modeSwitch.stay", { source: props.details.source })}
        </Button>
      </div>
      <div data-slot="mode-switch-live" role="status" aria-live="polite">
        <Show when={pending() && choice() !== "stay"}>
          {language.t("ui.permission.modeSwitch.switching", { target: props.details.target })}
        </Show>
      </div>
    </div>
  )
}
