export function race<T>(p: Promise<T>, ms: number): Promise<T> {
  let id: ReturnType<typeof setTimeout>
  return Promise.race([
    p.finally(() => clearTimeout(id)),
    new Promise<never>((_, rej) => {
      id = setTimeout(() => rej(new Error(`timed out after ${ms}ms`)), ms)
    }),
  ])
}
