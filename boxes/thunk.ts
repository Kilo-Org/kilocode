export function thunk<T>(init: () => T): () => T {
  let val: T | undefined
  let done = false
  return () => {
    if (done) return val as T
    done = true
    val = init()
    return val as T
  }
}
