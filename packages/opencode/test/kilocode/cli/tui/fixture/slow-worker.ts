import { Rpc } from "../../../../../src/util/rpc"
import { WorkerReady } from "../../../../../src/kilocode/cli/cmd/tui/worker-ready"

// Mimics the TUI worker: slow module startup before the RPC handler is installed.
await Bun.sleep(Number(process.env.KILO_TEST_WORKER_DELAY ?? 200))

Rpc.listen({
  ping: () => "pong",
})
if (!process.env.KILO_TEST_WORKER_SILENT) Rpc.emit(WorkerReady.Event, undefined)
