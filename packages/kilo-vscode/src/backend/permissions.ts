import type { OpenCodeClient, PermissionRequest } from "@opencode-ai/client/promise"
import type { EventPermissionAsked } from "./view-types"
import { result, type AdapterOptions } from "./result"

export function permissionView(request: PermissionRequest): EventPermissionAsked["properties"] {
  return {
    id: request.id,
    sessionID: request.sessionID,
    permission: request.action,
    patterns: request.resources,
    always: request.save ?? [],
    metadata: request.metadata ?? {},
    tool: request.source ? { messageID: request.source.messageID, callID: request.source.id } : undefined,
  }
}

export function createPermissionMethods(client: OpenCodeClient, defaultDirectory: string) {
  return {
    list: <Throw extends boolean = false>(input: { directory?: string } = {}, options?: AdapterOptions<Throw>) =>
      result(async () => {
        const response = await client.permission.request.list(
          { location: { directory: input.directory ?? defaultDirectory } },
          options,
        )
        return response.data.map(permissionView)
      }, options),
    reply: <Throw extends boolean = false>(
      input: {
        requestID: string
        directory?: string
        reply: "once" | "always" | "reject"
        message?: string
        interactive?: boolean
      },
      options?: AdapterOptions<Throw>,
    ) =>
      result(async () => {
        const response = await client.permission.request.list(
          { location: { directory: input.directory ?? defaultDirectory } },
          options,
        )
        const request = response.data.find((request) => request.id === input.requestID)
        if (!request) throw new Error("Permission request not found in this workspace")
        await client.permission.reply(
          { sessionID: request.sessionID, requestID: request.id, reply: input.reply, message: input.message },
          options,
        )
      }, options),
  }
}
