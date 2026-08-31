import type { UiI18nParams } from "@kilocode/kilo-ui/context"
import { useConfig } from "../src/context/config"
import { canUseSpeechToText, selectedSpeechToTextModel } from "../src/components/speech-to-text/availability"
import { useProvider } from "../src/context/provider"
import { useServer } from "../src/context/server"
import { useSpeechToText, type SpeechToText } from "../src/components/speech-to-text/useSpeechToText"
import { useSpeechToTextModels } from "../src/context/speech-to-text-models"
import { useVSCode } from "../src/context/vscode"

type T = (key: string, params?: UiI18nParams) => string

const notices: Record<string, string> = {
  "snapshots-disabled": "diffViewer.notice.snapshotsDisabled",
}

export function notice(t: T, kind?: string) {
  return kind ? t(notices[kind] ?? kind) : ""
}

export function reviewSendAllKeybind(t: T): string {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent)
    ? t("agentManager.review.sendAllShortcut.mac")
    : t("agentManager.review.sendAllShortcut.other")
}

export function createReviewSpeech(t: T): {
  speech: SpeechToText
  enabled: () => boolean
  model: () => string
} {
  const vscode = useVSCode()
  const server = useServer()
  const provider = useProvider()
  const { config } = useConfig()
  const speech = useSpeechToText(vscode, server, { t })
  const models = useSpeechToTextModels()
  return {
    speech,
    enabled: () => canUseSpeechToText(config(), provider.authStates()),
    model: () => selectedSpeechToTextModel(config(), models.models()),
  }
}

export function reviewFocus(root: () => HTMLElement | undefined): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => root()?.focus())
  })
}

export function keepsNativeFocus(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) return true
  return target instanceof HTMLElement && target.isContentEditable
}
