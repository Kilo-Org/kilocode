import { createHash } from "node:crypto"
import { InvalidError } from "@opencode-ai/core/v1/config/error"
import * as Log from "@opencode-ai/core/util/log"
import { ConfigVariableGuard } from "../config/variable"
import { KilocodeMarkdown } from "../config/markdown"

const log = Log.create({ service: "instruction" })

export namespace KilocodeInstruction {
  // Instructions are rebuilt for every prompt, so report each skipped entry once. The caller owns the set
  // (per-instance state) so it is released with the project instead of growing for the process lifetime.
  export type Warned = Set<string>

  function warn(warned: Warned, key: string, extra: Record<string, string>) {
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

  // Reasons are built from guard messages that quote only the reference token (never file or env values).
  function detail(err: unknown) {
    if (InvalidError.isInstance(err)) return err.data.message ?? err.name
    if (ConfigVariableGuard.isBlocked(err)) return err.message
    if (err instanceof Error) return err.name
    return "unknown error"
  }

  // Same as read(), but a failure yields "" and is logged instead of dropping the file silently.
  export async function readOrWarn(item: string, options: KilocodeMarkdown.Options, warned: Warned) {
    return read(item, options).catch((err: unknown) => {
      const blocked =
        ConfigVariableGuard.isBlocked(err) || (InvalidError.isInstance(err) && ConfigVariableGuard.isBlocked(err.cause))
      warn(warned, `read:${item}`, {
        path: item,
        reason: blocked ? "blocked" : "unreadable",
        detail: detail(err),
      })
      return ""
    })
  }

  // A configured instructions entry that resolves to no file. Entries are expanded config values and may
  // hold secrets ({env:...}, {file:...}), so log only the config source and a short fingerprint, never the value.
  export function unmatched(entry: string, source: string, dir: string, warned: Warned) {
    const id = createHash("sha256").update(entry).digest("hex").slice(0, 8)
    // When no origin was recorded the caller falls back to the entry itself as the source, so never echo it.
    const origin = source === entry ? "unknown" : source
    // Key on the logged fingerprint so the raw entry is not retained.
    warn(warned, `unmatched:${id}`, {
      source: origin,
      entry: `sha256:${id}`,
      directory: dir,
      reason: "no matching file",
    })
  }
}
