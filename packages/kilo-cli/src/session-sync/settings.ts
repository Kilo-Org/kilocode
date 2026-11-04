import { Effect } from "effect"
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser"
import { randomUUID } from "node:crypto"
import type { BigIntStats } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import { KiloConfigFiles } from "@opencode/util/kilocode/config/files"
import { Flock } from "@opencode/util/flock"
import { fail } from "./protocol"

// Sync is a global background service: project configuration must not silently opt a user back in.
// Use the same global filenames, precedence and JSONC editing convention as Config.update.
type Document = { file: string; text: string; revision: BigIntStats; enabled?: boolean }

export const settings = (directory: string) => {
  const documents = async () => {
    const result: Document[] = []
    for (const name of KiloConfigFiles.names) {
      const file = path.join(directory, name)
      const handle = await fs.open(file, "r").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined
        throw error
      })
      if (!handle) continue
      try {
        const revision = await handle.stat({ bigint: true })
        const text = await handle.readFile("utf8")
        const errors: ParseError[] = []
        const value: unknown = parse(text, errors, { allowTrailingComma: true, allowEmptyContent: true })
        if (
          errors.length ||
          (value !== undefined && (value === null || typeof value !== "object" || Array.isArray(value)))
        )
          throw new Error("Invalid global configuration")
        const enabled = value === undefined ? undefined : (value as Record<string, unknown>).session_sync
        if (enabled !== undefined && typeof enabled !== "boolean")
          throw new Error("session_sync must be a boolean")
        result.push({ file, text, revision, enabled })
      } finally {
        await handle.close()
      }
    }
    return result
  }
  return {
    enabled: Effect.tryPromise({
      try: documents,
      catch: () => fail("settings_unavailable", "Cannot read the global session_sync setting; synchronization is paused"),
    }).pipe(Effect.map((files) => files.findLast((file) => file.enabled !== undefined)?.enabled ?? true)),
    set: (enabled: boolean) => Effect.tryPromise({
      try: async (signal) => {
        await fs.mkdir(directory, { recursive: true })
        // Lock the whole filename set, including when no config file exists yet.
        const lock = await Flock.acquire("session-sync-settings", { dir: path.join(directory, ".locks"), signal })
        try {
          for (let attempt = 0; attempt < 8; attempt++) {
            signal.throwIfAborted()
            const files = await documents()
            const target = files.at(-1) ?? { file: path.join(directory, KiloConfigFiles.names.at(-1)!), text: "{}\n" }
            const updated = applyEdits(target.text, modify(target.text, ["session_sync"], enabled, {
              formattingOptions: { tabSize: 2, insertSpaces: true },
            }))
            const temporary = `${target.file}.${randomUUID()}.tmp`
            const output = await fs.open(temporary, "wx", 0o600)
            try {
              try {
                await output.writeFile(updated.endsWith("\n") ? updated : `${updated}\n`)
              } finally {
                await output.close()
              }
              // Rebase edits made by writers that do not take this lock, including atomic replacements and
              // newly created higher-precedence files. The final check cannot lock out a non-cooperating writer.
              const current = await documents()
              if (
                files.length !== current.length ||
                files.some((file, index) => {
                  const candidate = current[index]!
                  return (
                    file.file !== candidate.file || file.text !== candidate.text ||
                    file.revision.dev !== candidate.revision.dev || file.revision.ino !== candidate.revision.ino ||
                    file.revision.size !== candidate.revision.size || file.revision.mtimeNs !== candidate.revision.mtimeNs ||
                    file.revision.ctimeNs !== candidate.revision.ctimeNs
                  )
                })
              ) continue
              signal.throwIfAborted()
              await fs.rename(temporary, target.file)
              return
            } finally {
              await fs.rm(temporary, { force: true })
            }
          }
          throw new Error("Global configuration kept changing")
        } finally {
          await lock.release()
        }
      },
      catch: () => fail("settings_unavailable", "Cannot update the global session_sync setting"),
    }),
  }
}
