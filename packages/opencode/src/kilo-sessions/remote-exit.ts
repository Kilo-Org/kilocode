export namespace RemoteExit {
  export type Callback = () => Promise<void>

  let current: { callback: Callback; token: symbol } | undefined

  export function register(callback: Callback): () => void {
    const token = Symbol()
    current = { callback, token }
    return () => {
      if (current?.token === token) current = undefined
    }
  }

  export function get(): Callback | undefined {
    return current?.callback
  }
}
