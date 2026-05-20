import { AsyncLocalStorage } from "async_hooks"

export class NotFound extends Error {
  constructor(public label: string) {
    super(`no context for ${label}`)
  }
}

export function scope<T>(label: string) {
  const store = new AsyncLocalStorage<T>()
  return {
    use(): T {
      const v = store.getStore()
      if (!v) throw new NotFound(label)
      return v
    },
    provide<R>(val: T, fn: () => R): R {
      return store.run(val, fn)
    },
  }
}
