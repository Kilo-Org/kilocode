export function validInterest(message: Record<string, unknown>, usable: (id: string) => boolean): boolean {
  if (message.type !== "agentManager.prInterest" && message.type !== "agentManager.prDetailInterest") return true
  const id = message.projectId
  if (id != null && typeof id !== "string") return false
  return id == null || usable(id)
}
