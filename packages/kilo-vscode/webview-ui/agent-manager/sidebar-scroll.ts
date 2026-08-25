type Entry = {
  el: HTMLElement
  top: number
}

export function createSidebarScrollPreserver(
  root: ParentNode = document,
  schedule: typeof requestAnimationFrame = requestAnimationFrame,
  cancel: typeof cancelAnimationFrame = cancelAnimationFrame,
) {
  let frame: number | undefined
  let inner: number | undefined

  return (fn: () => void): void => {
    if (frame !== undefined) cancel(frame)
    if (inner !== undefined) cancel(inner)

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
        for (const item of scrolls) {
          if (item.el.isConnected) item.el.scrollTop = item.top
        }
      })
    })
  }
}
