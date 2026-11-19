import type { SessionInfo } from "@opencode/client"
import { createContext, createEffect, createSignal, useContext } from "solid-js"
import { unwrap } from "solid-js/store"
import type { PromptRef } from "../component/prompt"
import { useArgs } from "../context/args"
import { useLocal } from "../context/local"
import type { PromptInfo } from "../prompt/history"

export const ResumedPrompt = createContext<ReturnType<typeof createResumedPrompt>>()

export function createResumedPrompt(seed?: PromptInfo) {
  if (!seed || process.env.OPENCODE_APP_DIR_NAME !== "kilo2") return
  const [source, setSource] = createSignal<PromptInfo | undefined>(seed)
  const text = seed.text
  let owner: string | undefined
  let expected: SessionInfo["model"]

  return {
    text,
    owns(sessionID: string, ref: PromptRef) {
      return unwrap(ref.current) === source() && sessionID === owner
    },
    cancel() {
      setSource(undefined)
    },
    matchesModel(saved: SessionInfo, model: { providerID: string; modelID: string }, agent?: string) {
      if (!expected) {
        // An explicit --agent uses its own selection, not the saved agent's model.
        const initial = !agent || agent === saved.agent ? saved.model : undefined
        expected = initial ? { ...initial } : { providerID: model.providerID, id: model.modelID }
      }
      return model.providerID === expected.providerID && model.modelID === expected.id
    },
    bind(sessionID: string, ref: PromptRef, from?: PromptInfo) {
      if (!source() || (owner && owner !== sessionID)) return
      if (unwrap(from) !== source()) {
        if (owner === sessionID) setSource(undefined)
        return
      }
      owner = sessionID
      // Prompt stashes this exact object on cleanup; a replacement with identical text is not its continuation.
      setSource(unwrap(ref.current))
    },
  }
}

export function useResumedPrompt(
  sessionID: string,
  prompt: () => PromptRef | undefined,
  synced: () => boolean,
  session: () => SessionInfo | undefined,
) {
  const launch = useContext(ResumedPrompt)
  if (!launch) return
  const args = useArgs()
  const local = useLocal()
  createEffect(() => {
    const ref = prompt()
    if (!ref || !launch.owns(sessionID, ref)) return
    if (!unchanged(ref, launch.text)) return launch.cancel()
    const saved = session()
    if (!saved || !synced() || !local.model.ready || !local.model.catalogReady || !local.agent.current()) return
    const model = local.model.current()
    if (!model) return
    if (!launch.matchesModel(saved, model, args.agent)) return launch.cancel()
    if (local.model.available(model) && ref.submit()) launch.cancel()
  })
  return (ref: PromptRef, from?: PromptInfo) => launch.bind(sessionID, ref, from)
}

function unchanged(ref: PromptRef, text: string) {
  const draft = ref.current
  return (
    draft.text === text &&
    ref.mode === "normal" &&
    ![draft.files, draft.agents, draft.skills, draft.pasted].some((parts) => parts?.length)
  )
}
