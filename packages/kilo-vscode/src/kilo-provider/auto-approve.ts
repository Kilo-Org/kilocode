import type { AutoApproveController } from "../commands/toggle-auto-approve"

export type { AutoApproveController }

type Interceptor = (msg: Record<string, unknown>) => Promise<Record<string, unknown> | null>

export function createAutoApproveBridge(
  ctrl: AutoApproveController,
  post: (msg: unknown) => void,
  next?: Interceptor | null,
) {
  const send = (active = ctrl.active()) => post({ type: "autoApproveState", active })
  const sub = ctrl.onChange(send)
  return {
    dispose: () => sub.dispose(),
    async handle(msg: Record<string, unknown>) {
      if (msg.type === "toggleAutoApprove") return (await ctrl.toggle(), null)
      if (msg.type === "requestAutoApproveState") return (send(), null)
      if (msg.type === "webviewReady") send()
      return next ? next(msg) : msg
    },
  }
}
