/**
 * Minimal browser globals shim for running runtime contract checks in Bun.
 *
 * Several upstream dependencies access browser globals at module load time
 * when `isServer` is false (which happens with `--conditions=browser`):
 *   - @solidjs/router: window.history
 *   - @kobalte/utils: document.body.addEventListener
 *
 * This preload script provides just enough to avoid ReferenceErrors.
 */
if (typeof globalThis.window === "undefined") {
  const noop = () => {}
  const handler = { get: () => noop }
  const element = new Proxy({} as any, handler)
  ;(globalThis as any).document = {
    addEventListener: noop,
    removeEventListener: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => element,
    createElementNS: () => element,
    createTextNode: () => element,
    createComment: () => element,
    body: element,
    head: element,
    documentElement: element,
  }
  const history = {
    state: null as any,
    length: 1,
    replaceState(s: any) {
      history.state = s
    },
    pushState(s: any) {
      history.state = s
    },
    back: noop,
    forward: noop,
    go: noop,
  }
  ;(globalThis as any).window = {
    history,
    location: { href: "", pathname: "/", search: "", hash: "" },
    addEventListener: noop,
    removeEventListener: noop,
    dispatchEvent: () => true,
    document: (globalThis as any).document,
    navigator: { userAgent: "" },
    getComputedStyle: () => new Proxy({} as any, handler),
    requestAnimationFrame: noop,
    cancelAnimationFrame: noop,
    MutationObserver: class {
      observe() {}
      disconnect() {}
      takeRecords() {
        return []
      }
    },
    ResizeObserver: class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
    IntersectionObserver: class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  }
  ;(globalThis as any).navigator = (globalThis as any).window.navigator
  ;(globalThis as any).MutationObserver = (globalThis as any).window.MutationObserver
  ;(globalThis as any).ResizeObserver = (globalThis as any).window.ResizeObserver
  ;(globalThis as any).IntersectionObserver = (globalThis as any).window.IntersectionObserver
  ;(globalThis as any).requestAnimationFrame = noop
  ;(globalThis as any).cancelAnimationFrame = noop
  ;(globalThis as any).getComputedStyle = (globalThis as any).window.getComputedStyle
}
