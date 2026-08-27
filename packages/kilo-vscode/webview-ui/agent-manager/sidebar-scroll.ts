type Entry = {
  el: HTMLElement
  top: number
}

export function createSidebarScrollPreserver(
  active: () => string | null | undefined = () => undefined,
  root: ParentNode = document,
  schedule: typeof requestAnimationFrame = requestAnimationFrame,
  cancel: typeof cancelAnimationFrame = cancelAnimationFrame,
) {
  let frame: number | undefined
  let inner: number | undefined

  return (fn: () => void): void => {
    if (frame !== undefined) cancel(frame)
    if (inner !== undefined) cancel(inner)

    const prior = active()
    const scrolls: Entry[] = [...root.querySelectorAll<HTMLElement>(".am-worktree-list, .am-projects-list")].map(
      (el) => ({
        el,
        top: el.scrollTop,
      }),
    )
    fn()
    frame = schedule(() => {
      frame = undefined
      inner = schedule(() => {
        inner = undefined
        if (active() !== prior) return
        for (const item of scrolls) {
          if (item.el.isConnected && item.top > 0 && item.el.scrollTop === 0) item.el.scrollTop = item.top
        }
      })
    })
  }
}
