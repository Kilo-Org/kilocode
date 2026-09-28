import { createContext, createSignal, onCleanup, useContext, type Accessor, type ParentComponent } from "solid-js"
import { SPEECH_TO_TEXT_MODELS, type SpeechToTextModelDef } from "../../../src/speech-to-text/models"
import { useVSCode } from "./vscode"
import { useConfig } from "./config"
import type { ExtensionMessage } from "../types/messages"
import { hasCustomSpeechToTextSource } from "../components/speech-to-text/availability"
import {
  initialSpeechToTextCatalog,
  reduceSpeechToTextCatalog,
  visibleSpeechToTextModels,
  type SpeechToTextSourceKind,
} from "../components/speech-to-text/catalog-state"

export type SpeechToTextModelsContextValue = {
  models: Accessor<readonly SpeechToTextModelDef[]>
}

export const SpeechToTextModelsContext = createContext<SpeechToTextModelsContextValue>({
  models: () => SPEECH_TO_TEXT_MODELS,
})

export const SpeechToTextModelsProvider: ParentComponent = (props) => {
  const vscode = useVSCode()
  const config = useConfig().config
  const [catalog, setCatalog] = createSignal(initialSpeechToTextCatalog)
  const request = () => vscode.postMessage({ type: "requestSpeechToTextModels" })
  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type !== "speechToTextModelsLoaded") return
    setCatalog((prev) => reduceSpeechToTextCatalog(prev, message))
  })

  request()
  const retry = setTimeout(request, 3000)
  onCleanup(() => clearTimeout(retry))
  onCleanup(unsubscribe)

  // The active source follows the visible config, so an unsaved draft switch drops
  // the previous catalog immediately instead of showing it in the new mode.
  const source = (): SpeechToTextSourceKind => (hasCustomSpeechToTextSource(config()) ? "custom" : "gateway")

  const models = () => visibleSpeechToTextModels(catalog(), source())

  return <SpeechToTextModelsContext.Provider value={{ models }}>{props.children}</SpeechToTextModelsContext.Provider>
}

export function useSpeechToTextModels(): SpeechToTextModelsContextValue {
  return useContext(SpeechToTextModelsContext)
}
