// kilocode_change - new file
// A worker that mirrors the TUI worker's shape: heavy async setup before `Rpc.listen` runs.
// Stands in for the real one's several hundred module imports, without paying for them.
import { Rpc } from "@/util/rpc"

await new Promise((resolve) => setTimeout(resolve, 150))

export const rpc = {
  ping(input: { value: string }) {
    return { echo: input.value }
  },
}

Rpc.listen(rpc)
