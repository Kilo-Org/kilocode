export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timeoutId: NodeJS.Timeout | null = null
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Operation timed out after ${ms}ms`))
    }, ms)
  })
  return Promise.race([
    promise.then((result) => {
      if (timeoutId) clearTimeout(timeoutId)
      return result
    }),
    timeoutPromise,
  ])
}
