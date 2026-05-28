export namespace KiloSessionTuiSync {
  export function model(input: { role: string; parts?: readonly { type: string }[] }) {
    if (input.role !== "user") return false
    if (!input.parts) return false
    return !input.parts.some((part) => part.type === "compaction")
  }
}
