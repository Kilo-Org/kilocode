import { homedir } from "os"
import path from "path"
import { MemoryPaths as Core } from "../storage/paths"

/** Context-bound paths over the pure core. The host (home/config dirs) is injected at bootstrap so
 * the package does not hard-code the opencode global directory; defaults to `~/.kilo`. */
export namespace MemoryPaths {
  export type Ctx = Core.Ctx
  export type Files = Core.Files
  export type Identity = Core.Identity
  export type Host = Core.Host

  // A provider (not a snapshot) so hosts that resolve home/config dynamically — e.g. from env at
  // call time — are reflected on every `root` call.
  let host: () => Host = () => ({ home: homedir(), config: path.join(homedir(), ".kilo") })

  export function configure(next: () => Host) {
    host = next
  }

  export function identity(input: { ctx: Ctx }): Identity {
    return Core.identity(input)
  }

  export function root(input: { ctx: Ctx }) {
    const { home, config } = host()
    return Core.root({ ctx: input.ctx, home, config })
  }

  export const files = Core.files
  export const source = Core.source
}
