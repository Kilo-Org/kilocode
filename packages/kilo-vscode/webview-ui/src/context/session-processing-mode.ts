import type { Accessor } from "solid-js"
import { createStore, produce } from "solid-js/store"
import type { ModelSelection, ProcessingMode, Provider } from "../types/messages"
import { DEFAULT_PROCESSING_MODE, supportsFlex as modelSupportsFlex } from "./processing-mode"

interface Options {
  session: Accessor<string | undefined>
  selected: (sessionID?: string) => ModelSelection | null
  providers: Accessor<Record<string, Provider>>
  authStates: Accessor<Record<string, "api" | "oauth" | "wellknown">>
}

export function createSessionProcessingMode(options: Options) {
  const [selections, setSelections] = createStore<Record<string, ProcessingMode>>({})
  const key = (sessionID?: string) => sessionID ?? options.session() ?? "global"

  const current = (sessionID?: string): ProcessingMode =>
    selections[key(sessionID)] ?? (sessionID ? selections.global : undefined) ?? DEFAULT_PROCESSING_MODE

  const peek = (sessionID?: string) => selections[sessionID ?? options.session() ?? "global"]
  const select = (value: ProcessingMode, sessionID?: string) => setSelections(key(sessionID), value)
  const clear = (sessionID: string) => setSelections(produce((modes) => void delete modes[sessionID]))
  const recover = (sessionID: string, value: ProcessingMode | undefined) => {
    if (value && selections[sessionID] === undefined) select(value, sessionID)
  }

  const supports = (sessionID?: string) =>
    modelSupportsFlex(options.providers(), options.authStates(), options.selected(sessionID))

  return { current, peek, select, clear, recover, supports }
}
