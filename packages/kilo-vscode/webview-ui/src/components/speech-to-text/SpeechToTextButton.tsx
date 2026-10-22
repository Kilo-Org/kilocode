import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
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
    <IconButton
      icon="microphone"
      variant="ghost"
      size="small"
      onClick={click}
      disabled={locked()}
      aria-label={label()}
      aria-disabled={locked()}
      aria-busy={busy()}
      aria-pressed={props.speech.state() === "recording"}
      aria-keyshortcuts={speechShortcutValue()}
      loading={busy()}
      class={`prompt-speech-button prompt-speech-button--${props.speech.state()}`}
    />
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
