import { createSignal } from "solid-js"

export function createWorktreeRecency(storage: {
  get: () => Record<string, unknown> | undefined
  set: (state: Record<string, unknown>) => void
}) {
  const value = storage.get()?.worktreeMentionHistory
  const [recent, setRecent] = createSignal(
    Array.isArray(value)
      ? [...new Set(value.filter((path): path is string => typeof path === "string" && path.length > 0))].slice(0, 100)
      : [],
  )
  const visit = (path: string) => {
    if (!path) return
    setRecent((previous) => {
      if (previous[0] === path) return previous
      const next = [path, ...previous.filter((item) => item !== path)].slice(0, 100)
      storage.set({ ...storage.get(), worktreeMentionHistory: next })
      return next
    })
  }
  return { recent, visit }
}
