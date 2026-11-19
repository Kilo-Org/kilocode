import type { SessionInfo } from "@opencode/client"
import { createEffect } from "solid-js"
import type { PromptRef } from "../component/prompt"
import { useArgs } from "../context/args"
import { useLocal } from "../context/local"

export function submitResumedPrompt(
  ref: PromptRef,
  text: string,
  synced: () => boolean,
  session: () => SessionInfo | undefined,
) {
  const local = useLocal()
  const args = useArgs()
  let done = false
  let expected: SessionInfo["model"]
  createEffect(() => {
    if (done) return
    const draft = ref.current
    if (
      draft.text !== text ||
      ref.mode !== "normal" ||
      [draft.files, draft.agents, draft.skills, draft.pasted].some((parts) => parts?.length)
    ) {
      done = true
      return
    }
    if (!synced() || !local.model.ready || !local.model.catalogReady || !local.agent.current()) return
    const model = local.model.current()
    if (!model) return
    if (!expected) {
      const saved = session()
      // A different --agent uses its own selection, not the saved agent's model.
      const initial = !args.agent || args.agent === saved?.agent ? saved?.model : undefined
      expected = initial ? { ...initial } : { providerID: model.providerID, id: model.modelID }
    }
    if (model.providerID !== expected.providerID || model.modelID !== expected.id) {
      done = true
      return
    }
    if (!local.model.available(model)) return
    done = ref.submit()
  })
}
