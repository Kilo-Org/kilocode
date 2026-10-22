import type { PermissionRequest } from "../types/messages"

export function upsertPermission(list: PermissionRequest[], permission: PermissionRequest) {
  const idx = list.findIndex((item) => item.id === permission.id)
  if (idx === -1) return [...list, permission]
  const next = list.slice()
  next[idx] = permission
  return next
}

export function removeSessionPermissions(list: PermissionRequest[], sessionID: string) {
  return list.filter((item) => item.sessionID !== sessionID)
}
