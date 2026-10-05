import { Duration, Exit } from "effect"

/**
 * Cache lifetime for an InstanceState lookup. The lookup runs on the fiber of the first
 * caller, so a client that disconnects mid-lookup interrupts it. That interruption is not
 * a result: expire it at once so the next caller closes the abandoned scope (running the
 * finalizers it registered) and builds the state again. Real values and failures stay cached.
 */
export const ttl = <A, E>(exit: Exit.Exit<A, E>) => (Exit.hasInterrupts(exit) ? Duration.zero : Duration.infinity)
