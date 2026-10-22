import { MemoryShared } from "./recall/shared"
import type { MemoryOperations } from "./capture/operations"

/** Human-facing messages describing an explicit apply result. */
export namespace MemoryNotice {
  export function saved(input: { added: number; removed: number }) {
    return input.removed > 0 || input.added > 0
  }

  export function message(input: { ops: MemoryOperations.Op[]; added: number; removed: number; count: number }) {
    const refs = MemoryShared.refs(input.ops)
    if (input.added > 0 && input.removed > 0) return `Memory updated · ${input.added} saved, ${input.removed} removed`
    if (input.added > 0) return `Memory saved · ${refs.join(", ") || `${input.added} ops`}`
    if (input.removed > 0) return `Memory updated · ${input.removed} removed`
    return `Memory unchanged · ${input.count} ops`
  }
}
