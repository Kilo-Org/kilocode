import * as Log from "@opencode-ai/core/util/log"
import { ConfigVariableGuard } from "../config/variable"
import { KilocodeMarkdown } from "../config/markdown"

const log = Log.create({ service: "instruction" })

export namespace KilocodeInstruction {
  // Instructions are rebuilt for every prompt, so report each skipped entry once per process.
  const warned = new Set<string>()

  function warn(key: string, extra: Record<string, string>) {
    if (warned.has(key)) return
    warned.add(key)
    log.warn("instruction file skipped", extra)
  }

  export function content(text: string, item: string, options: KilocodeMarkdown.Options) {
    return KilocodeMarkdown.substitute(text, item, options)
  }

  export async function read(item: string, options: KilocodeMarkdown.Options) {
    return content(await KilocodeMarkdown.read(item, options), item, options)
  }

  // Same as read(), but a failure yields "" and is logged instead of dropping the file silently.
  export async function readOrWarn(item: string, options: KilocodeMarkdown.Options) {
    return read(item, options).catch((err: unknown) => {
      const blocked = ConfigVariableGuard.isBlocked(err)
      const detail = err instanceof Error ? err.message : String(err)
      warn(`read:${item}`, {
        path: item,
        reason: blocked ? "blocked: outside project config scope" : "unreadable",
        detail,
      })
      return ""
    })
  }

  // A configured instructions entry that resolves to no file.
  export function unmatched(entry: string) {
    warn(`unmatched:${entry}`, { path: entry, reason: "no matching file" })
  }
}
