import { createContext, createSignal, onCleanup, useContext, type Accessor, type ParentComponent } from "solid-js"
import { SPEECH_TO_TEXT_MODELS, type SpeechToTextModelDef } from "../../../src/speech-to-text/models"
import { useVSCode } from "./vscode"
import type { ExtensionMessage } from "../types/messages"

export type SpeechToTextModelsContextValue = {
  models: Accessor<readonly SpeechToTextModelDef[]>
}

export const SpeechToTextModelsContext = createContext<SpeechToTextModelsContextValue>({
  models: () => SPEECH_TO_TEXT_MODELS,
})

export const SpeechToTextModelsProvider: ParentComponent = (props) => {
  const vscode = useVSCode()
  const [models, setModels] = createSignal<readonly SpeechToTextModelDef[]>([...SPEECH_TO_TEXT_MODELS])
  const request = () => vscode.postMessage({ type: "requestSpeechToTextModels" })
  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type !== "speechToTextModelsLoaded") return
    setModels(message.models)
  })

  request()
  const retry = setTimeout(request, 3000)
  onCleanup(() => clearTimeout(retry))
  onCleanup(unsubscribe)

  return <SpeechToTextModelsContext.Provider value={{ models }}>{props.children}</SpeechToTextModelsContext.Provider>
}

export function useSpeechToTextModels(): SpeechToTextModelsContextValue {
  return useContext(SpeechToTextModelsContext)
}
