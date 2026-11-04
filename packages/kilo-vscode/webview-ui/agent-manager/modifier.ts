export function watch(target: Window, mac: boolean, set: (held: boolean) => void) {
  const name = mac ? "Meta" : "Control"
  const key = (event: KeyboardEvent) => {
    if (event.key === name) {
      set(event.type === "keydown")
      return
    }
    set(mac ? event.metaKey : event.ctrlKey)
  }
  const pointer = (event: PointerEvent) => set(mac ? event.metaKey : event.ctrlKey)
  const reset = () => set(false)

  target.addEventListener("keydown", key, true)
  target.addEventListener("keyup", key, true)
  target.addEventListener("pointermove", pointer, true)
  target.addEventListener("blur", reset)

  return () => {
    target.removeEventListener("keydown", key, true)
    target.removeEventListener("keyup", key, true)
    target.removeEventListener("pointermove", pointer, true)
    target.removeEventListener("blur", reset)
  }
}
