export function capture(container: HTMLElement, root: HTMLElement, move: (offset: number) => void) {
  const shadow = container.querySelector("diffs-container")?.shadowRoot
  if (!shadow) return
  const view = root.getBoundingClientRect()
  const box = container.getBoundingClientRect()
  if (box.bottom <= view.top || box.top >= view.bottom) return
  let anchor: HTMLElement | undefined
  for (const node of shadow.querySelectorAll<HTMLElement>("[data-line][data-line-index]")) {
    const rect = node.getBoundingClientRect()
    if (rect.height === 0) continue
    if (rect.top > view.top && anchor) break
    anchor = node
    if (rect.bottom > view.top) break
  }
  if (!anchor) return
  const index = anchor.dataset.lineIndex
  const top = anchor.getBoundingClientRect().top
  const offset = root.scrollTop
  return () => {
    if (root.scrollTop !== offset || !container.isConnected) return
    const node = anchor.isConnected
      ? anchor
      : shadow.querySelector<HTMLElement>(`[data-line][data-line-index="${index}"]`)
    const rect = node?.getBoundingClientRect()
    if (!rect?.height) return
    const delta = rect.top - top
    if (Math.abs(delta) > 0.5) move(offset + delta)
  }
}
