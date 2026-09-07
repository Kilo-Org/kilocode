type Definition = {
  [method: string]: (input: any) => any
}

export function listen(rpc: Definition) {
  onmessage = async (evt) => {
    const parsed = JSON.parse(evt.data)
    if (parsed.type === "rpc.request") {
      const result = await rpc[parsed.method](parsed.input)
      postMessage(JSON.stringify({ type: "rpc.result", result, id: parsed.id }))
    }
  }
  // kilocode_change start - announce that the handler exists.
  //
  // A worker installs this only after its whole module graph has evaluated, and the TUI's worker
  // imports the entire server — so the main process can reach its first request first. Anything it
  // posts before this point is dropped by the runtime rather than queued, and `call` has no
  // rejection path or timeout, so a single lost request hangs the caller forever. The client holds
  // requests until it sees this.
  postMessage(JSON.stringify({ type: "rpc.ready" }))
  // kilocode_change end
}

export function emit(event: string, data: unknown) {
  postMessage(JSON.stringify({ type: "rpc.event", event, data }))
}

export function client<T extends Definition>(target: {
  postMessage: (data: string) => void | null
  onmessage: ((this: Worker, ev: MessageEvent<any>) => any) | null
}) {
  const pending = new Map<number, (result: any) => void>()
  const listeners = new Map<string, Set<(data: any) => void>>()
  let id = 0
  // kilocode_change start - requests raised before the target announced its handler, in order.
  let ready = false
  const queued: string[] = []
  const send = (message: string) => {
    if (ready) target.postMessage(message)
    else queued.push(message)
  }
  // kilocode_change end
  target.onmessage = async (evt) => {
    const parsed = JSON.parse(evt.data)
    // kilocode_change start - flush anything raised while the target was still loading
    if (parsed.type === "rpc.ready") {
      ready = true
      for (const message of queued) target.postMessage(message)
      queued.length = 0
      return
    }
    // kilocode_change end
    if (parsed.type === "rpc.result") {
      const resolve = pending.get(parsed.id)
      if (resolve) {
        resolve(parsed.result)
        pending.delete(parsed.id)
      }
    }
    if (parsed.type === "rpc.event") {
      const handlers = listeners.get(parsed.event)
      if (handlers) {
        for (const handler of handlers) {
          handler(parsed.data)
        }
      }
    }
  }
  return {
    call<Method extends keyof T>(method: Method, input: Parameters<T[Method]>[0]): Promise<ReturnType<T[Method]>> {
      const requestId = id++
      return new Promise((resolve) => {
        pending.set(requestId, resolve)
        send(JSON.stringify({ type: "rpc.request", method, input, id: requestId })) // kilocode_change
      })
    },
    on<Data>(event: string, handler: (data: Data) => void) {
      let handlers = listeners.get(event)
      if (!handlers) {
        handlers = new Set()
        listeners.set(event, handlers)
      }
      handlers.add(handler)
      return () => {
        handlers!.delete(handler)
      }
    },
  }
}

export * as Rpc from "./rpc"
