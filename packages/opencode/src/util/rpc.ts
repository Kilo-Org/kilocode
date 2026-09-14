import { KiloRpcHandshake } from "@/kilocode/util/rpc-handshake" // kilocode_change

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
  KiloRpcHandshake.announce((data) => postMessage(data)) // kilocode_change - the client holds requests until it sees this
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
  const gate = KiloRpcHandshake.gate(target) // kilocode_change - hold requests until the target announces its handler
  target.onmessage = async (evt) => {
    const parsed = JSON.parse(evt.data)
    if (gate.accept(parsed)) return // kilocode_change - the announcement, which also flushes what was held
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
      // kilocode_change - `fail` runs only for a request the gate could not hand over
      return new Promise((resolve, reject) => {
        pending.set(requestId, resolve)
        gate.send(JSON.stringify({ type: "rpc.request", method, input, id: requestId }), (error) => {
          pending.delete(requestId)
          reject(error)
        })
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
