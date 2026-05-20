export function cleanup(fn: () => void | Promise<void>): AsyncDisposable & Disposable {
  return {
    [Symbol.dispose]() { void fn() },
    [Symbol.asyncDispose]() { return Promise.resolve(fn()) },
  }
}
