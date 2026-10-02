import type { ApproveForMeController } from "../commands/toggle-approve-for-me"

export type { ApproveForMeController }

type Interceptor = (msg: Record<string, unknown>) => Promise<Record<string, unknown> | null>

export function createApproveForMeBridge(
  ctrl: ApproveForMeController,
  post: (msg: unknown) => void,
  next?: Interceptor | null,
) {
  const send = () => post({ type: "approveForMeState", active: ctrl.active(), visible: ctrl.visible() })
  const sub = ctrl.onChange(send)
  return {
    dispose: () => sub.dispose(),
    async handle(msg: Record<string, unknown>) {
      if (msg.type === "toggleApproveForMe") return (await ctrl.toggle(), null)
      if (msg.type === "requestApproveForMeState") return (send(), null)
      if (msg.type === "webviewReady") send()
      return next ? next(msg) : msg
    },
  }
}
