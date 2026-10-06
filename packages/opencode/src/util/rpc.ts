import { KiloRpc } from "@/kilocode/util/rpc" // kilocode_change

type Definition = {
  [method: string]: (input: any) => any
}

// kilocode_change start - replay messages queued before the handler existed and answer failures,
// so a dropped request or a throwing method can no longer hang the caller forever
export function listen(rpc: Definition) {
  KiloRpc.listen(rpc)
}

export const arm = KiloRpc.arm
// kilocode_change end

export function emit(event: string, data: unknown) {
  postMessage(JSON.stringify({ type: "rpc.event", event, data }))
}

// kilocode_change start - reject on worker-reported failures and bound the pre-handshake window
export function client<T extends Definition>(target: {
  postMessage: (data: string) => void | null
  onmessage: ((this: Worker, ev: MessageEvent<any>) => any) | null
}) {
  return KiloRpc.client<T>(target)
}
// kilocode_change end

export * as Rpc from "./rpc"
