import { MemoryShared } from "./recall/shared"
import type { MemoryOperations } from "./capture/operations"

/** Human-facing messages and audit views describing an explicit apply result. */
export namespace MemoryNotice {
  export function saved(input: { added: number; removed: number }) {
    return input.removed > 0 || input.added > 0
  }

  export function summary(input: { added: number; removed: number; count: number }) {
    if (input.added > 0 && input.removed > 0) {
      return `explicit memory operation saved ${input.added} and removed ${input.removed}`
    }
    if (input.added > 0) return `explicit memory operation saved ${input.added} ops`
    if (input.removed > 0) return `explicit memory operation removed ${input.removed} entries`
    if (input.count > 0) return "explicit memory operation matched no source memory"
    return "explicit memory operation had no accepted ops"
  }

  export function message(input: { ops: MemoryOperations.Op[]; added: number; removed: number; count: number }) {
    const refs = MemoryShared.refs(input.ops)
    if (input.added > 0 && input.removed > 0) return `Memory updated · ${input.added} saved, ${input.removed} removed`
    if (input.added > 0) return `Memory saved · ${refs.join(", ") || `${input.added} ops`}`
    if (input.removed > 0) return `Memory updated · ${input.removed} removed`
    return `Memory unchanged · ${input.count} ops`
  }

  export function skip(input: MemoryOperations.Rejection[]) {
    return input.map((item) => (item.reason === "out_of_scope" ? { reason: item.reason } : item))
  }

  export function ops(input: { ops: MemoryOperations.Op[]; skipped: MemoryOperations.Rejection[] }) {
    const blocked = new Set(input.skipped.filter((item) => item.reason === "out_of_scope").map((item) => item.text))
    return MemoryShared.audit(input.ops.filter((item) => item.action !== "add" || !blocked.has(item.text)))
  }
}
