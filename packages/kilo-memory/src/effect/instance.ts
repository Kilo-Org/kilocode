/** Injectable instance-context binder. The Effect service bridges async package calls through
 * this binder so host-provided context (e.g. opencode's per-instance ALS) survives the await.
 * Defaults to identity so the package stays runnable without a host. */
export namespace MemoryInstance {
  export type Binder = <A>(fn: () => Promise<A>) => () => Promise<A>

  let binder: Binder = (fn) => fn

  export function setBinder(next: Binder) {
    binder = next
  }

  export function bind<A>(fn: () => Promise<A>): () => Promise<A> {
    return binder(fn)
  }
}
