/**
 * cancel.ts — Auto-aborting AbortController + signal combiner
 * Zero deps.
 *
 * const { signal, clearTimeout } = cancelAfter(5000)
 */
export function cancelAfter(ms: number) {
  const ctrl = new AbortController()
  const id = setTimeout(ctrl.abort.bind(ctrl), ms)
  return { controller: ctrl, signal: ctrl.signal, clear: () => globalThis.clearTimeout(id) }
}

export function cancelAny(ms: number, ...signals: AbortSignal[]) {
  const t = cancelAfter(ms)
  return { signal: AbortSignal.any([t.signal, ...signals]), clear: t.clear }
}
