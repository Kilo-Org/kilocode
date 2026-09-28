import type { CaffeinationService } from "./service"

export function confirmCaffeination(
  service: Pick<CaffeinationService, "getState" | "setEnabled">,
  ask: () => Promise<boolean>,
) {
  let accepted = false
  let pending: Promise<void> | undefined
  let revision = 0

  return (enabled: boolean): Promise<void> => {
    if (!enabled) {
      revision++
      return service.setEnabled(false)
    }
    const state = service.getState()
    if (state.enabled || !state.available) return Promise.resolve()
    if (accepted) return service.setEnabled(true)
    if (pending) return pending

    const current = revision
    pending = Promise.resolve()
      .then(ask)
      .then((answer) => {
        if (!answer || current !== revision) return
        accepted = true
        return service.setEnabled(true)
      })
      .catch((error: unknown) => {
        console.warn("[Kilo New] Keep-awake confirmation failed:", error)
      })
      .finally(() => {
        pending = undefined
      })
    return pending
  }
}
