import { createEffect, type Component } from "solid-js"
import { useConfig } from "../../context/config"
import { useProvider } from "../../context/provider"
import { getVSCodeAPI } from "../../context/vscode"
import { canUseSpeechToText } from "./availability"

export const SpeechToTextPrewarm: Component = () => {
  const vscode = getVSCodeAPI()
  const provider = useProvider()
  const { config } = useConfig()
  let prepared = false

  createEffect(() => {
    if (prepared || !canUseSpeechToText(config(), provider.authStates())) return
    prepared = true
    vscode.postMessage({ type: "speechToTextPrewarm" })
  })

  return null
}
