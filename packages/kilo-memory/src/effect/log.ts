/** Injectable diagnostic logger. Opencode wires this to its structured logger at bootstrap;
 * the package defaults to a no-op so it never reaches into the host runtime on its own. */
export namespace MemoryLog {
  export type Fn = (message: string, meta?: Record<string, unknown>) => void

  let warnFn: Fn = () => {}
  let debugFn: Fn = () => {}

  export function setWarn(fn: Fn) {
    warnFn = fn
  }

  export function setDebug(fn: Fn) {
    debugFn = fn
  }

  export function warn(message: string, meta?: Record<string, unknown>) {
    warnFn(message, meta)
  }

  export function debug(message: string, meta?: Record<string, unknown>) {
    debugFn(message, meta)
  }
}
