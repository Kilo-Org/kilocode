/** Injectable diagnostic logger. Opencode wires this to its structured logger at bootstrap;
 * the package defaults to a no-op so it never reaches into the host runtime on its own. */
export namespace MemoryLog {
  export type Fn = (message: string, meta?: Record<string, unknown>) => void

  let warnFn: Fn = () => {}

  export function setWarn(fn: Fn) {
    warnFn = fn
  }

  export function warn(message: string, meta?: Record<string, unknown>) {
    warnFn(message, meta)
  }
}
