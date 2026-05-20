export function abortAfter(ms: number) {
  const ctrl = new AbortController()
  const id = setTimeout(ctrl.abort.bind(ctrl), ms)
  return {
    controller: ctrl,
    signal: ctrl.signal,
    clear() { globalThis.clearTimeout(id) },
  }
}

export function abortAny(ms: number, ...signals: AbortSignal[]) {
  const t = abortAfter(ms)
  return {
    signal: AbortSignal.any([t.signal, ...signals]),
    clear: t.clear,
  }
}
