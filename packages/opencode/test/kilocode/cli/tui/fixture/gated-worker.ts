import { WorkerReady } from "../../../../../src/kilocode/cli/cmd/tui/worker-ready"
import { Rpc } from "../../../../../src/util/rpc"

// Shared memory releases initialization even on runtimes that buffer worker messages during top-level await.
const gate = new Int32Array(new SharedArrayBuffer(4))
postMessage(gate)
await Promise.resolve().then(() => Atomics.wait(gate, 0, 0))

Rpc.listen({ ping: () => "pong" })
Rpc.emit(WorkerReady.Event, undefined)
