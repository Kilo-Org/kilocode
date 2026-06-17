import { Global } from "@opencode-ai/core/global"
import { MemoryPaths as Core } from "@kilocode/kilo-memory/paths"

export namespace MemoryPaths {
  export type Ctx = Core.Ctx
  export type Files = Core.Files
  export type Identity = Core.Identity

  export function identity(input: { ctx: Ctx }): Identity {
    return Core.identity(input)
  }

  export function root(input: { ctx: Ctx }) {
    return Core.root({ ctx: input.ctx, home: Global.Path.home, config: Global.Path.config })
  }

  export const files = Core.files
  export const source = Core.source
}
