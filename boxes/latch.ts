export function latch() {
  let resolve: () => void
  const p = new Promise<void>((r) => { resolve = r })
  return {
    trip() { resolve() },
    wait() { return p },
  }
}
