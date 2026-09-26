// kilocode_change - new file
// Delays Rpc.listen, like the TUI worker's module graph does.
import { Rpc } from "@/util/rpc"

await new Promise((resolve) => setTimeout(resolve, 150))

export const rpc = {
  ping(input: { value: string }) {
    return { echo: input.value }
  },
}

Rpc.listen(rpc)
