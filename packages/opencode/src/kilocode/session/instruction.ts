import path from "node:path"
import { Effect } from "effect"
import type { FSUtil } from "@opencode-ai/core/fs-util"
import { KilocodeMarkdown } from "../config/markdown"

export namespace KilocodeInstruction {
  export const glob = Effect.fn("KilocodeInstruction.glob")(function* (fs: FSUtil.Interface, instruction: string) {
    let dir = path.dirname(instruction)
    let pattern = path.basename(instruction)
    while (!(yield* fs.isDir(dir))) {
      const parent = path.dirname(dir)
      if (parent === dir) break
      pattern = `${path.basename(dir)}/${pattern}`
      dir = parent
    }
    return yield* fs.glob(pattern, { cwd: dir, absolute: true, include: "file", dot: true })
  })

  export function content(text: string, item: string, options: KilocodeMarkdown.Options) {
    return KilocodeMarkdown.substitute(text, item, options)
  }

  export async function read(item: string, options: KilocodeMarkdown.Options) {
    return content(await KilocodeMarkdown.read(item, options), item, options)
  }
}
