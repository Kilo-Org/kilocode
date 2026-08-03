import { Button } from "@kilocode/kilo-ui/button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { onCleanup, Show, type Component } from "solid-js"
import type { SpeechToText } from "./useSpeechToText"
import { speechShortcutLabel, speechShortcutValue, toggleSpeech } from "./shortcut"

type Props = {
  speech: SpeechToText
  disabled?: boolean
  start: () => void
  label: (key: string) => string
}

export const SpeechToTextButton: Component<Props> = (props) => {
  const unavailable = () => !!props.disabled && props.speech.state() === "idle"
  const locked = () => unavailable() || props.speech.state() === "starting"
  const busy = () => props.speech.state() === "starting" || props.speech.state() === "transcribing"
  const label = () => {
    if (props.speech.state() === "starting") return props.label("speechToText.tooltip.starting")
    if (props.speech.state() === "recording") return props.label("speechToText.tooltip.stop")
    if (props.speech.state() === "transcribing") return props.label("speechToText.tooltip.transcribing")
    if (props.speech.state() === "error") return props.speech.error() || props.label("speechToText.tooltip.error")
    return props.label("speechToText.tooltip.start")
  }
  const title = () => `${label()} ${props.label("speechToText.tooltip.shortcut")}`

  const click = () => toggleSpeech(props.speech, unavailable(), props.start)

  onCleanup(() => {
    if (props.speech.active()) props.speech.cancel()
  })

  const button = () => (
    <Button
      variant="ghost"
      size="small"
      onClick={click}
      disabled={locked()}
      aria-label={label()}
      aria-disabled={locked()}
      aria-busy={busy()}
      aria-pressed={props.speech.state() === "recording"}
      aria-keyshortcuts={speechShortcutValue()}
      class={`prompt-speech-button prompt-speech-button--${props.speech.state()}`}
    >
      {busy() ? (
        <Spinner style={{ width: "16px", height: "16px" }} />
      ) : (
        <svg class="prompt-speech-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M8 10.5C9.38 10.5 10.5 9.38 10.5 8V4C10.5 2.62 9.38 1.5 8 1.5C6.62 1.5 5.5 2.62 5.5 4V8C5.5 9.38 6.62 10.5 8 10.5Z"
            stroke="currentColor"
            stroke-width="1.2"
          />
          <path
            d="M3.5 7.5C3.5 10 5.5 12 8 12C10.5 12 12.5 10 12.5 7.5"
            stroke="currentColor"
            stroke-width="1.2"
            stroke-linecap="round"
          />
          <path d="M8 12V14.5M5.5 14.5H10.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
        </svg>
      )}
    </Button>
  )

  return (
    <Tooltip
      value={
        <Show when={props.speech.state() === "idle"} fallback={<span>{label()}</span>}>
          <div data-slot="tooltip-keybind">
            <span>{title()}</span>
            <span data-slot="tooltip-keybind-key">{speechShortcutLabel()}</span>
          </div>
        </Show>
      }
      placement="top"
      openDelay={0}
    >
      {button()}
    </Tooltip>
  )
}
