// Pure config-file editing for the Settings host: `jsonc-parser` writes that keep comments, the Kilo file-name guard,
// and the v1-alias removal. Kept free of `vscode` imports so it is unit-testable.
import path from "node:path"
// The ESM entry: the extension host bundles with `Bun.build`, which leaves the UMD entry's
// `require("./impl/format")` as a runtime require that fails in `dist/extension.js`.
import { applyEdits, findNodeAtLocation, modify, parseTree } from "jsonc-parser/lib/esm/main.js"
import { KiloConfigFiles } from "@opencode/util/kilocode/config/files"
import type { ConfigEdit } from "./protocol"

const MODIFY = { formattingOptions: { tabSize: 2, insertSpaces: true, eol: "\n" } }

/**
 * Run tasks one at a time in call order. Each task's result resolves its own promise; a rejected task does not break
 * the chain, so a later write still runs. A read-modify-write over one file must be serialized, or two overlapping
 * passes both read the pre-edit text and the later write drops the earlier edit.
 */
export function serialize(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve()
  return (task) => {
    const result = tail.then(task)
    tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}

/** True only for the Kilo v2 config file names, so a write never lands in another file. */
export function isKiloConfigFile(file: string): boolean {
  return KiloConfigFiles.names.includes(path.basename(file))
}

/** Apply each edit in order, removing the v1 aliases of every written v2 path in the same pass. */
export function applyConfigEdits(text: string, edits: ConfigEdit[]): string {
  let result = text.trim().length > 0 ? text : "{\n}\n"
  for (const edit of edits) {
    if (!Array.isArray(edit.path) || edit.path.length === 0) continue
    result = applyEdits(result, modify(result, edit.path, edit.value, MODIFY))
    for (const alias of aliasOf(edit.path)) {
      // jsonc-parser throws when a delete targets a path the document does not define, so only remove a present alias.
      const root = parseTree(result)
      if (!root || !findNodeAtLocation(root, alias)) continue
      result = applyEdits(result, modify(result, alias, undefined, MODIFY))
    }
  }
  return result
}

/**
 * The v1 keys that a written v2 path replaces, so both spellings never define the same setting. Every legacy key
 * `core/config/normalize.ts` still reads is listed: `agent`/`mode` merge into `agents`, `tools`/`permission` into
 * `permissions`, `plugin` into `plugins`, and `attachment`/`autoupdate`/`autoshare`/`reference` into their v2 names.
 */
export function aliasOf(keyPath: string[]): string[][] {
  if (keyPath.length === 0) return []
  if (keyPath[0] === "agents") {
    if (keyPath.length === 3 && keyPath[1] === "title" && keyPath[2] === "model") return [["small_model"]]
    const tail = keyPath.slice(2)
    if (tail.length === 1 && tail[0] === "system")
      return [
        ["agent", keyPath[1]!, "prompt"],
        ["mode", keyPath[1]!, "prompt"],
      ]
    if (tail.length === 1 && tail[0] === "disabled")
      return [
        ["agent", keyPath[1]!, "disable"],
        ["mode", keyPath[1]!, "disable"],
      ]
    return [
      ["agent", ...keyPath.slice(1)],
      ["mode", ...keyPath.slice(1)],
    ]
  }
  if (keyPath[0] === "mcp" && keyPath[1] === "servers" && keyPath.length >= 3) return [["mcp", ...keyPath.slice(2)]]
  if (keyPath[0] === "compaction") {
    if (keyPath[1] === "keep") return [["compaction", "preserve_recent_tokens"]]
    if (keyPath[1] === "buffer" && keyPath.length === 2) return [["compaction", "reserved"]]
    return []
  }
  if (keyPath[0] === "policies")
    return [["enabled_providers"], ["disabled_providers"], ["experimental", "policies"]]
  const top: Record<string, string[]> = {
    permissions: ["permission", "tools"],
    commands: ["command"],
    providers: ["provider"],
    snapshots: ["snapshot"],
    plugins: ["plugin"],
    media: ["attachment"],
    update: ["autoupdate"],
    share: ["autoshare"],
    references: ["reference"],
  }
  const mapped = top[keyPath[0]!]
  return mapped ? mapped.map((alias) => [alias, ...keyPath.slice(1)]) : []
}
