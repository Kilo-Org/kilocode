export function call<T>(fn: () => T): T {
  return fn()
}
