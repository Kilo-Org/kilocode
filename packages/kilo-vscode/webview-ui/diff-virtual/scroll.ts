type Frame = (cb: FrameRequestCallback) => number

type Scroller = {
  scrollTop: number
  scrollLeft: number
}

export function resetScroll(el: Scroller | undefined, frame: Frame = requestAnimationFrame): void {
  if (!el) return

  const reset = () => {
    el.scrollTop = 0
    el.scrollLeft = 0
  }

  reset()
  frame(() => {
    reset()
    frame(reset)
  })
}
