import { KilocodeInstructionRules } from "./instruction-rules"

export namespace KilocodeInstruction {
  export function content(text: string, item: string) {
    return KilocodeInstructionRules.parse(text, item).then((rule) => rule.content)
  }

  export const rule = KilocodeInstructionRules.parse
  export const match = KilocodeInstructionRules.match
  export const claude = KilocodeInstructionRules.claude
}
