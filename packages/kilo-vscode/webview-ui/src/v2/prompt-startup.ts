import { createSignal, onCleanup } from "solid-js"

/** Initial prompts have not reached the server yet, so Stop must cancel their client-side preparation. */
export function createPromptStartup() {
  const [pending, setPending] = createSignal<ReadonlyMap<string, AbortController>>(new Map())
  onCleanup(() => pending().forEach((controller) => controller.abort()))
  const remove = (id: string, controller: AbortController) => {
    if (pending().get(id) !== controller) return
    setPending((current) => {
      const next = new Map(current)
      next.delete(id)
      return next
    })
  }
  return {
    pending: (id: string | undefined) => !!id && pending().has(id),
    start(id: string) {
      pending().get(id)?.abort()
      const controller = new AbortController()
      setPending((current) => new Map(current).set(id, controller))
      return { signal: controller.signal, done: () => remove(id, controller) }
    },
    cancel(id: string) {
      const controller = pending().get(id)
      if (!controller) return false
      controller.abort()
      remove(id, controller)
      return true
    },
  }
}
