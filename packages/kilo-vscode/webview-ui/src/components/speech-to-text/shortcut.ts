import type { SpeechState, SpeechToText } from "./useSpeechToText"

type Key = Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey">
type Press = Key & Pick<KeyboardEvent, "repeat" | "timeStamp">

export const SPEECH_HOLD_MS = 400

export function isSpeechShortcut(event: Key, mac = isMac()): boolean {
  const mod = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
  return event.key.toLowerCase() === "k" && mod && !event.altKey && !event.shiftKey
}

export function speechShortcutLabel(mac = isMac()): string {
  return mac ? "⌘K" : "Ctrl+K"
}

export function speechShortcutValue(mac = isMac()): string {
  return mac ? "Meta+K" : "Control+K"
}

export function toggleSpeech(speech: SpeechToText, disabled: boolean, start: () => void): boolean {
  if (speech.state() === "starting") return true
  if (speech.state() === "recording") {
    speech.stop()
    return true
  }
  if (speech.state() === "transcribing") {
    speech.cancel()
    return true
  }
  if (speech.state() === "error") {
    speech.clear()
    return true
  }
  if (disabled) return false
  start()
  return true
}

type ShortcutOptions = {
  speech: SpeechToText
  disabled: () => boolean
  start: () => void
  finish: (submit: boolean) => void
  mac?: boolean
}

export function createSpeechShortcut(opts: ShortcutOptions) {
  let press: { state: SpeechState; time: number; mac: boolean } | undefined

  const release = (event: KeyboardEvent) => {
    if (!up(event)) return
    event.preventDefault()
    event.stopPropagation()
  }

  const disarm = () => {
    if (typeof window === "undefined") return
    window.removeEventListener("keyup", release, true)
    window.removeEventListener("blur", loseFocus)
    document.removeEventListener("visibilitychange", hide, true)
  }

  const loseFocus = () => {
    if (!press) return
    press = undefined
    disarm()
    opts.finish(false)
  }

  const hide = () => {
    if (document.visibilityState === "hidden") loseFocus()
  }

  const down = (event: Press): boolean => {
    const mac = opts.mac ?? isMac()
    if (!isSpeechShortcut(event, mac)) return false
    if (event.repeat) return !!press
    press = undefined

    const state = opts.speech.state()
    if (state === "idle" && opts.disabled()) return false
    press = { state, time: event.timeStamp, mac }
    if (typeof window !== "undefined") {
      window.addEventListener("keyup", release, true)
      window.addEventListener("blur", loseFocus)
      document.addEventListener("visibilitychange", hide, true)
    }

    if (state === "idle") opts.start()
    if (state === "transcribing" || state === "error") toggleSpeech(opts.speech, false, opts.start)
    return true
  }

  const up = (event: Pick<KeyboardEvent, "key" | "timeStamp">): boolean => {
    if (!press) return false
    const key = event.key.toLowerCase()
    const ended = key === "k" || (press.mac ? key === "meta" : key === "control")
    if (!ended) return false
    const current = press
    press = undefined
    disarm()

    if (current.state === "transcribing" || current.state === "error") return true
    const submit = event.timeStamp - current.time >= SPEECH_HOLD_MS
    if (current.state !== "idle" || submit) opts.finish(submit)
    return true
  }

  const reset = () => {
    press = undefined
    disarm()
  }

  return { down, up, reset }
}

function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent)
}
