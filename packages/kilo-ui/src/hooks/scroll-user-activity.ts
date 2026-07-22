interface UserActivityOptions {
  grace: number
  onWheelUp: () => void
}

const isPotentialScrollInput = (event: Event) => {
  if (!(event.target instanceof Element)) return true
  const editable = event.target.closest<HTMLElement>("[contenteditable]")
  return !event.target.closest("button, input, textarea, select") && !editable?.isContentEditable
}

export const createUserActivity = (options: UserActivityOptions) => {
  let marked = false
  let time = 0
  let scroll: HTMLElement | undefined

  // Mark input that may cause the next scroll so layout-driven scroll events
  // do not get mistaken for the user leaving auto-follow mode.
  const mark = (event: Event) => {
    if (!isPotentialScrollInput(event)) return
    marked = true
    time = performance.now()
  }

  const handleWheel = (event: WheelEvent) => {
    if (event.deltaY >= 0 || !scroll || scroll.scrollTop <= 0) return
    time = performance.now()
    options.onWheelUp()
  }

  return {
    listen: (el: HTMLElement) => {
      scroll = el
      el.addEventListener("wheel", handleWheel, { passive: true, capture: true })
      el.addEventListener("pointerdown", mark, { passive: true })
      el.addEventListener("keydown", mark, { passive: true })
      el.addEventListener("touchstart", mark, { passive: true })

      return () => {
        if (scroll === el) scroll = undefined
        el.removeEventListener("wheel", handleWheel, { capture: true })
        el.removeEventListener("pointerdown", mark)
        el.removeEventListener("keydown", mark)
        el.removeEventListener("touchstart", mark)
      }
    },
    consumeScroll: () => {
      const value = marked
      marked = false
      return value
    },
    isRecent: () => time > 0 && performance.now() - time < options.grace,
  }
}
