// Pure config-file editing for the Settings host: `jsonc-parser` writes that keep comments, the Kilo file-name guard,
// and the v1-alias removal. Kept free of `vscode` imports so it is unit-testable.
import path from "node:path"
// The ESM entry: the extension host bundles with `Bun.build`, which leaves the UMD entry's
// `require("./impl/format")` as a runtime require that fails in `dist/extension.js`.
import { applyEdits, findNodeAtLocation, modify, parseTree } from "jsonc-parser/lib/esm/main.js"
import { KiloConfigFiles } from "@opencode/util/kilocode/config/files"
import { aliasOf } from "./config-aliases"
import type { ConfigEdit } from "./protocol"

export { aliasOf }

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

/** Apply each edit in order, removing the v1 aliases of every written v2 path unless the edit preserves them. */
export function applyConfigEdits(text: string, edits: ConfigEdit[]): string {
  let result = text.trim().length > 0 ? text : "{\n}\n"
  for (const edit of edits) {
    if (!Array.isArray(edit.path) || edit.path.length === 0) continue
    result = applyEdits(result, modify(result, edit.path, edit.value, MODIFY))
    if (edit.preserveAliases) continue
    for (const alias of aliasOf(edit.path)) {
      // jsonc-parser throws when a delete targets a path the document does not define, so only remove a present alias.
      const root = parseTree(result)
      if (!root || !findNodeAtLocation(root, alias)) continue
      result = applyEdits(result, modify(result, alias, undefined, MODIFY))
    }
  }
  return result
}

