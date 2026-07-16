import type { MemoryStatusResponse } from "@kilocode/sdk/v2"

type State = MemoryStatusResponse["state"]

export namespace MemoryTuiState {
  export function verbose(input: Pick<State, "verbose"> | undefined) {
    return input?.verbose ?? false
  }

  export function enabled(input: Pick<State, "enabled"> | undefined) {
    return input?.enabled ?? false
  }

  export function active(input: { markers: number; saved: boolean }) {
    return input.markers > 0 || input.saved
  }
}
