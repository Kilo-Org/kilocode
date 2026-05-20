/**
 * rpc.ts — JSON-RPC over Worker postMessage
 * Zero deps.
 *
 * // Worker side:
 * serve({ ping: async (x) => x })
 * // Host side:
 * const c = connect(worker)
 * await c.call("ping", "hello")
 */
type Api = { [m: string]: (i: any) => any }

export function serve(api: Api) {
  onmessage = async (e) => {
    const p = JSON.parse(e.data)
    if (p.type === "req") {
      const result = await api[p.method](p.input)
      postMessage(JSON.stringify({ type: "res", result, id: p.id }))
    }
  }
}

export function emit(event: string, data: unknown) {
  postMessage(JSON.stringify({ type: "evt", event, data }))
}

export function connect<T extends Api>(target: { postMessage: (d: string) => void | null; onmessage: ((e: MessageEvent) => any) | null }) {
  const pending = new Map<number, (v: any) => void>()
  const subs = new Map<string, Set<(d: any) => void>>()
  let seq = 0
  target.onmessage = (e) => {
    const p = JSON.parse(e.data)
    if (p.type === "res") { pending.get(p.id)?.(p.result); pending.delete(p.id) }
    if (p.type === "evt") subs.get(p.event)?.forEach(fn => fn(p.data))
  }
  return {
    call<M extends keyof T>(method: M, input: Parameters<T[M]>[0]): Promise<ReturnType<T[M]>> {
      const id = seq++
      return new Promise(r => { pending.set(id, r); target.postMessage(JSON.stringify({ type: "req", method, input, id })) })
    },
    on<D>(event: string, fn: (d: D) => void) {
      let s = subs.get(event); if (!s) { s = new Set(); subs.set(event, s) }
      s.add(fn)
      return () => s!.delete(fn)
    },
  }
}
