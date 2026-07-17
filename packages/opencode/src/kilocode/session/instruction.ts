import { KilocodeMarkdown } from "../config/markdown"
import { IgnorePermission } from "../permission/ignore"
import type { InstanceContext } from "@/project/instance-context"

export namespace KilocodeInstruction {
  function resolve(input: KilocodeMarkdown.Options, ctx: InstanceContext): KilocodeMarkdown.Options {
    const authorize = ({ requested, target }: { requested: string; target: string }) =>
      IgnorePermission.allowed({
        ctx,
        access: "read",
        candidates: [{ requested, target }],
      })
    return {
      ...input,
      fileScope: input.fileScope,
      sourceScope: input.sourceScope,
      authorize,
    }
  }

  export function content(text: string, item: string, input: KilocodeMarkdown.Options, ctx: InstanceContext) {
    return KilocodeMarkdown.substitute(text, item, input)
  }

  export async function read(item: string, input: KilocodeMarkdown.Options, ctx: InstanceContext) {
    const options = resolve(input, ctx)
    return content(await KilocodeMarkdown.read(item, options), item, options, ctx)
  }
}
