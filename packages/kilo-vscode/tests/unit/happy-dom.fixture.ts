import { Window } from "happy-dom"

/**
 * Install happy-dom globals the webview code relies on, and return a restore function.
 *
 * The webview modules read `window` and `document` as globals, so a test that
 * exercises them has to put a DOM in place first.
 */
export function useDom(window: Window, names: string[]) {
  const restore: Array<() => void> = []
  for (const name of names) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name)
    const value = name === "window" ? window : (window as unknown as Record<string, unknown>)[name]
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
    restore.push(() => {
      if (previous) Object.defineProperty(globalThis, name, previous)
      else Reflect.deleteProperty(globalThis, name)
    })
  }
  return () => restore.forEach((fn) => fn())
}
