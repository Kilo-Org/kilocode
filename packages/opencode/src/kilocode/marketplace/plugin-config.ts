import path from "path"
import { Global } from "@opencode-ai/core/global"
import { parse, type ParseError } from "jsonc-parser"
import { ConfigPaths } from "@/config/paths"
import { patchPluginConfig, type PatchDeps, type PatchInput } from "@/plugin/install"
import { Filesystem } from "@/util/filesystem"

// Keep upstream config selection, JSONC editing, identity rules, and locks. Its
// writes are sequential, so a failure must report the changes already made.
export async function patchPlugin(input: PatchInput, write: PatchDeps["write"] = Filesystem.write) {
  const attempted: string[] = []
  const completed: string[] = []
  try {
    const root = input.vcs === "git" && input.worktree !== "/" ? input.worktree : input.directory
    const dir = input.global ? (input.config ?? Global.Path.config) : path.join(root, ".kilo")
    // Preflight every target before any write. The upstream writer validates
    // again under its lock; failures caused by later changes are reported below.
    for (const target of input.targets) {
      const files = ConfigPaths.fileInDirectory(dir, target.kind === "server" ? "opencode" : "tui")
      const existing = await Promise.all(
        files.map(async (file) => ((await Filesystem.exists(file)) ? file : undefined)),
      )
      const file = existing.find((file) => file !== undefined) ?? files.at(0)!
      const src = await Filesystem.readText(file).catch((err: NodeJS.ErrnoException) => {
        if (err.code === "ENOENT") return "{}"
        throw err
      })
      const errors: ParseError[] = []
      const data = parse(src.trim() ? src : "{}", errors, { allowTrailingComma: true })
      if (errors.length) throw new Error(`Invalid JSON in ${file}; file left unchanged`)
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error(`Invalid plugin config in ${file}: expected an object`)
      }
      if (data.plugin !== undefined && !Array.isArray(data.plugin)) {
        throw new Error(`Invalid plugin config in ${file}: expected a plugin array`)
      }
    }
    const out = await patchPluginConfig(input, {
      files: ConfigPaths.fileInDirectory,
      exists: Filesystem.exists,
      readText: Filesystem.readText,
      write: async (file, text) => {
        attempted.push(file)
        await write(file, text)
        completed.push(file)
      },
    })
    if (!out.ok) {
      if (out.code === "invalid_json") {
        throw new Error(`Invalid JSON in ${out.file} (${out.parse} at line ${out.line}, column ${out.col})`)
      }
      throw out.error
    }
    return { success: true as const, files: out.items.map((item) => item.file) }
  } catch (err) {
    const failed = attempted.filter((file) => !completed.includes(file))
    const changed = completed.length ? ` Updated config files: ${completed.join(", ")}.` : ""
    // A failed write can truncate a file before throwing, so do not claim that
    // the failed destination is unchanged or that retry alone will repair it.
    const uncertain = failed.length ? ` Failed config writes (files may have changed): ${failed.join(", ")}.` : ""
    const detail = err instanceof Error ? err.message : String(err)
    return { success: false as const, error: `Plugin installation incomplete.${changed}${uncertain} ${detail}` }
  }
}
