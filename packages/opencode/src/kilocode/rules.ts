// kilocode_change - new file
import path from "path"
import { Effect } from "effect"
import z from "zod"
import { Instruction } from "@/session/instruction"

export namespace KiloRules {
  export const Info = z.object({
    path: z.string(),
    name: z.string(),
  })
  export type Info = z.infer<typeof Info>

  export const list = Effect.fn("KiloRules.list")(function* () {
    const instruction = yield* Instruction.Service
    const paths = yield* instruction.systemPaths()
    return Array.from(paths)
      .map((file) => ({
        path: file,
        name: path.basename(file),
      }))
      .toSorted((a, b) => a.path.localeCompare(b.path))
  })
}
