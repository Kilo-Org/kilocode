import type { AgentInfo } from "@opencode/client"
import { useLog } from "../context/log"
import { useTuiLifecycle } from "../context/runtime"
import { useStorageOptional } from "../context/storage"
import type { ModelPreferenceModel } from "../model-preference"

export function createAgentModelPreferences() {
  if (process.env.OPENCODE_APP_DIR_NAME !== "kilo2") return
  const storage = useStorageOptional()
  if (!storage) return
  const lifecycle = useTuiLifecycle()
  const log = useLog()
  const [picks, update] = storage.store<Record<string, ModelPreferenceModel>>("agent-models", { initial: {} })
  let pending = Promise.resolve()

  return {
    get(agent?: AgentInfo) {
      return agent && picks[`agent:${agent.id}`]
    },
    save(agent: AgentInfo | undefined, model: ModelPreferenceModel) {
      if (!agent) return
      const key = `agent:${agent.id}`
      // A configured agent may switch temporarily, but must not leave an old pick to restore later.
      const pick = agent.model ? undefined : { providerID: model.providerID, modelID: model.modelID }
      pending = pending
        .then(() =>
          update((draft) => {
            if (pick) draft[key] = pick
            else delete draft[key]
          }),
        )
        .catch((error) => log.warn("Failed to save agent model preference", { error }))
      // A quick second pick or exit must not leave the first model on disk.
      const unregister = lifecycle.add(() => pending)
      void pending.then(unregister)
    },
  }
}
