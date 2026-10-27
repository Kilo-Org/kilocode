// A worker held in the window that actually broke the TUI: the event loop is alive but no
// message handler exists yet. The compiled worker spends ~2s there evaluating
// Server/InstanceRuntime and awaiting log init, and Bun 1.4.2 silently discards anything the
// parent posts into it. Verified directly: with the loop running and no `onmessage`, a posted
// message never arrives, while a thread parked in `Atomics.wait` merely queues it.
//
// So the stall must keep the loop running -- polling a shared gate rather than blocking on it
// -- otherwise nothing is reproduced. The gate keeps it deterministic instead of timing
// dependent, and the parent releases it once it has posted into the window.
import { KiloRpc } from "../../../../src/kilocode/util/rpc"

const gate = new Int32Array(new SharedArrayBuffer(4))
postMessage(gate)
while (Atomics.load(gate, 0) === 0) await Bun.sleep(5)

// Mirrors production ordering: arm, then listen once the handlers exist.
KiloRpc.arm()
KiloRpc.listen({
  ping: (input: string) => `pong ${input}`,
  boom: () => {
    throw new Error("handler exploded")
  },
})
