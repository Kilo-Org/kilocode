type Throttled<A extends any[]> = {
  call(...a: A): void
  flush(): void
}

export function throttle<A extends any[]>(
  fn: (...a: A) => void,
  ms: number,
): Throttled<A> {
  let last = 0
  let pending: A | undefined
  let id: ReturnType<typeof setTimeout> | undefined
  const run = (a: A) => {
    last = Date.now()
    fn(...a)
  }
  return {
    call(...a: A) {
      pending = a
      const gap = ms - (Date.now() - last)
      if (gap <= 0) { run(a); pending = undefined }
      else if (id === undefined) {
        id = setTimeout(() => { id = undefined; if (pending) { run(pending); pending = undefined } }, gap)
      }
    },
    flush() {
      if (id !== undefined) { clearTimeout(id); id = undefined }
      if (pending) { run(pending); pending = undefined }
    },
  }
}
