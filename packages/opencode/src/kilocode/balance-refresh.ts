// Lets actions that change the active account (e.g. /teams org switch) tell the sidebar balance
// to re-fetch immediately, instead of waiting for its poll. Same-process pub/sub, no event-bus plumbing.
const subscribers = new Set<() => void>()

export function onBalanceRefresh(fn: () => void): () => void {
  subscribers.add(fn)
  return () => subscribers.delete(fn)
}

export function refreshBalance(): void {
  for (const fn of subscribers) fn()
}
