import { homedir } from "os"
import path from "path"
import { MemoryPaths as Core } from "../storage/paths"

/** Context-bound paths over the pure core. The host data dir is injected at bootstrap so
 * the package does not hard-code the opencode global directory; defaults to XDG-style data storage. */
export namespace MemoryPaths {
  export type Ctx = Core.Ctx
  export type Files = Core.Files
  export type Identity = Core.Identity
  export type Host = Core.Host

  // A provider (not a snapshot) so hosts that resolve the data dir dynamically — e.g. from env at
  // call time — are reflected on every `root` call.
  let host: () => Host = () => ({
    data: path.join(process.env.XDG_DATA_HOME ?? path.join(homedir(), ".local", "share"), "kilo"),
  })

  export function configure(next: () => Host) {
    host = next
  }

  export function identity(input: { ctx: Ctx }): Identity {
    return Core.identity(input)
  }

  export function root(input: { ctx: Ctx }) {
    return Core.root({ ctx: input.ctx, ...host() })
  }

  export const files = Core.files
  export const source = Core.source
}
