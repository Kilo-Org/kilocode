import type { OpenCodeClient } from "@opencode/client"
import { KiloHostedRpc } from "@opencode/schema/kilocode/hosted"
import type { ChatRoute } from "./route"

export type CloudManagementAction = "info" | "rename" | "delete"

/** A dialog owns the operation key across retries. Dismissal is strictly local. */
export function managementActions(api: OpenCodeClient, route: ChatRoute) {
  const rpc = api.rpc(KiloHostedRpc.Definition)
  const target = route.target
  const operationKey = crypto.randomUUID()
  const controller = new AbortController()
  const options = { location: { directory: route.directory }, signal: controller.signal }
  return {
    info: () => rpc.sessionInfo({ target }, options),
    rename: (title: string) => rpc.renameSession({ target, title }, options),
    confirmDelete: () => rpc.deleteSession({ target, operationKey }, options),
    dismiss: () => controller.abort(),
  }
}
