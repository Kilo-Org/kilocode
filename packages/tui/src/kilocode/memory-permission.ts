import { isRecord } from "../util/record"

/** Permission prompt presentation for the Kilo memory tools; undefined for every other action. */
export function memoryPermissionPresentation(source: { action: string; metadata?: unknown; input?: unknown }) {
  if (source.action !== "kilo_memory_save" && source.action !== "kilo_memory_recall") return
  const metadata = {
    ...(isRecord(source.input) ? source.input : {}),
    ...(isRecord(source.metadata) ? source.metadata : {}),
  }
  const value = String(metadata.text ?? metadata.query ?? "")
  const lines = [value || "No memory content provided"]
  if (source.action === "kilo_memory_recall") return { icon: "◇", title: "Memory recall", lines }
  return { icon: "◇", title: `Memory ${String(metadata.action ?? "save")}`, lines }
}
