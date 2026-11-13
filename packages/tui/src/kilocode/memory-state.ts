import type { KiloMemoryRpc } from "@opencode/schema/kilocode/memory"

type State = KiloMemoryRpc.State

export namespace MemoryTuiState {
  export function enabled(input: Pick<State, "enabled"> | undefined) {
    return input?.enabled ?? false
  }

  export function active(input: { markers: number; saved: boolean }) {
    return input.markers > 0 || input.saved
  }
}
