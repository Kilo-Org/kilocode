import { spyOn } from "bun:test"

// Count the real requests at the client. A timeout can fire before the child has accepted the connection,
// so its request log is not a reliable count of the probes that triggered eviction.
export function observeHealthProbes(url: string) {
  const endpoint = new URL("/api/info", url).href
  const requests = spyOn(globalThis, "fetch")
  return {
    count: () => requests.mock.calls.filter(([input]) => String(input) === endpoint).length,
    [Symbol.dispose]: () => requests.mockRestore(),
  }
}
