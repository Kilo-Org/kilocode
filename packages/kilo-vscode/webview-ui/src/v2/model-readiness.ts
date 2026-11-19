import type { ModelInfo, ModelRef } from "@opencode/client"
import { waitForModel } from "@opencode/client/kilocode/model-startup"
import { createEffect, createSignal, on, onCleanup, type Accessor } from "solid-js"
import type { V2 } from "./scope"

export function modelAvailable(models: readonly ModelInfo[] | undefined, model: ModelRef | undefined) {
  return (
    !!model && !!models?.some((item) => item.enabled && item.providerID === model.providerID && item.id === model.id)
  )
}

/** Gate Send, not editing. A settled missing model keeps the server's normal error path instead of blocking forever. */
export function createModelReadiness(v2: V2, selected: Accessor<ModelRef | undefined>, prepared: Accessor<boolean>) {
  const [ready, setReady] = createSignal(false)
  createEffect(
    on(
      () =>
        [
          v2.connection.status(),
          prepared(),
          selected()?.providerID,
          selected()?.id,
          modelAvailable(v2.data.location.model.list(), selected()),
        ] as const,
      ([status, prepared, providerID, id, available]) => {
        setReady(false)
        if (status !== "connected" || !prepared) return
        if (available) return void setReady(true)
        const controller = new AbortController()
        onCleanup(() => controller.abort())
        void waitForModel(v2.api, {
          location: { directory: v2.directory },
          model: providerID && id ? { providerID, id } : undefined,
          signal: controller.signal,
        })
          .then(async () => {
            if (controller.signal.aborted) return
            await v2.data.location.model.sync()
            if (!controller.signal.aborted) setReady(true)
          })
          .catch((error: unknown) => {
            if (!controller.signal.aborted) v2.report(error)
          })
      },
    ),
  )
  return ready
}
