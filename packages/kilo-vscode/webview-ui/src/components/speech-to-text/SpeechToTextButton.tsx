import { Button } from "@kilocode/kilo-ui/button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import type { Component } from "solid-js"
import type { SpeechToText } from "./useSpeechToText"

type Props = {
  speech: SpeechToText
  disabled?: boolean
  start: () => void
  label: (key: string) => string
}

export const SpeechToTextButton: Component<Props> = (props) => {
  const disabled = () => !!props.disabled
  const label = () => {
    if (props.speech.state() === "recording") return props.label("speechToText.tooltip.stop")
    if (props.speech.state() === "transcribing") return props.label("speechToText.tooltip.transcribing")
    if (props.speech.state() === "error") return props.speech.error() || props.label("speechToText.tooltip.error")
    return props.label("speechToText.tooltip.start")
  }

  const click = () => {
    if (props.speech.state() === "recording") {
      props.speech.stop()
      return
    }
    if (props.speech.state() === "transcribing") {
      props.speech.cancel()
      return
    }
    if (props.speech.state() === "error") {
      props.speech.clear()
      return
    }
    if (disabled()) return
    props.start()
  }

  return (
    <Tooltip value={label()} placement="top">
      <Button
        variant="ghost"
        size="small"
        onClick={click}
        disabled={disabled()}
        aria-label={label()}
        aria-pressed={props.speech.state() === "recording"}
        class={`prompt-speech-button prompt-speech-button--${props.speech.state()}`}
      >
        {props.speech.state() === "transcribing" ? (
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
    </Tooltip>
  )
}
