type Debounced<A extends any[]> = {
  call(...a: A): void
  cancel(): void
}

export function debounce<A extends any[]>(
  fn: (...a: A) => void,
  ms: number,
): Debounced<A> {
  let id: ReturnType<typeof setTimeout> | undefined
  return {
    call(...a: A) {
      if (id !== undefined) clearTimeout(id)
      id = setTimeout(() => { id = undefined; fn(...a) }, ms)
    },
    cancel() {
      if (id !== undefined) { clearTimeout(id); id = undefined }
    },
  }
}
