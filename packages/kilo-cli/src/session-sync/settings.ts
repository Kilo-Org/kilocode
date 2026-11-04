import { Effect } from "effect"
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { KiloConfigFiles } from "@opencode/util/kilocode/config/files"
import { fail } from "./protocol"

// Sync is a global background service: project configuration must not silently opt a user back in.
// Use the same global filenames, precedence and JSONC editing convention as Config.update.
export const settings = (directory: string) => {
  const documents = Effect.tryPromise({
    try: async () => {
      const result: { file: string; text: string; enabled?: boolean }[] = []
      for (const name of KiloConfigFiles.names) {
        const file = path.join(directory, name)
        const text = await readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return undefined
          throw error
        })
        if (text === undefined) continue
        const errors: ParseError[] = []
        const value = parse(text, errors, { allowTrailingComma: true })
        if (errors.length || !value || typeof value !== "object" || Array.isArray(value))
          throw new Error("Invalid global configuration")
        if (value.session_sync !== undefined && typeof value.session_sync !== "boolean")
          throw new Error("session_sync must be a boolean")
        result.push({ file, text, enabled: value.session_sync })
      }
      return result
    },
    catch: () => fail("settings_unavailable", "Cannot read the global session_sync setting; synchronization is paused"),
  })
  return {
    enabled: documents.pipe(Effect.map((files) => files.findLast((file) => file.enabled !== undefined)?.enabled ?? true)),
    set: (enabled: boolean) =>
      documents.pipe(
        Effect.flatMap((files) =>
          Effect.tryPromise({
            try: async () => {
              const target = files.at(-1) ?? { file: path.join(directory, KiloConfigFiles.names.at(-1)!), text: "{}\n" }
              const updated = applyEdits(target.text, modify(target.text, ["session_sync"], enabled, {
                formattingOptions: { tabSize: 2, insertSpaces: true },
              }))
              await mkdir(directory, { recursive: true })
              await writeFile(target.file, updated.endsWith("\n") ? updated : `${updated}\n`)
            },
            catch: () => fail("settings_unavailable", "Cannot update the global session_sync setting"),
          }),
        ),
      ),
  }
}
