import { MemoryTuiEvents } from "@/kilocode/cli/cmd/tui/memory-events"

export namespace MemorySessionTui {
  export function attach(input: Parameters<typeof MemoryTuiEvents.attach>[0]) {
    return MemoryTuiEvents.attach(input)
  }
}
