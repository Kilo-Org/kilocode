import { onMount, onCleanup } from "solid-js"

/** Run after the focused control has had a chance to consume Escape. */
export function useInterruptKey(
  running: () => boolean,
  stop: () => void,
  owns: (event: KeyboardEvent) => boolean = () => true,
) {
  onMount(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || event.defaultPrevented || !owns(event) || !running()) return
      event.preventDefault()
      stop()
    }
    document.addEventListener("keydown", handler)
    onCleanup(() => document.removeEventListener("keydown", handler))
  })
}
