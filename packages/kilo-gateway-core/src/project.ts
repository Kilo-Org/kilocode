export * as KiloProject from "./project.js"

import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { Effect, Option, Schema } from "effect"

const execFileAsync = promisify(execFile)

const ConfigFile = Schema.fromJsonString(
  Schema.Struct({
    project: Schema.optionalKey(
      Schema.Struct({
        id: Schema.optionalKey(Schema.String),
      }),
    ),
  }),
)
const decodeConfigFile = Schema.decodeUnknownOption(ConfigFile)

// Normalizes a project identifier like v1 `normalizeProjectId` (`packages/opencode/src/kilocode/project-id.ts`):
// extracts the repository name from HTTP(S)/SSH/SCP git URLs, strips `.git`, and truncates to the last 100 chars.
export function normalize(input: string): string {
  const trimmed = input.trim()
  if (URL.canParse(trimmed)) {
    const url = new URL(trimmed)
    const pathname = url.pathname.replace(/\.git$/i, "")
    const parts = pathname.split("/").filter(Boolean)
    const repo = parts.at(-1)
    return (repo || trimmed).slice(-100)
  }
  const scpMatch = /^git@[^:]+:(.+)/i.exec(trimmed)
  if (scpMatch?.[1]) {
    const pathname = scpMatch[1].replace(/\.git$/i, "")
    const parts = pathname.split("/").filter(Boolean)
    const repo = parts.at(-1)
    return (repo || trimmed).slice(-100)
  }
  return trimmed.slice(-100)
}

// Resolves the project ID for a directory with v1 priority:
// 1. `.kilo/config.json` (`project.id`)
// 2. `.kilocode/config.json` (`project.id`)
// 3. `git config --get remote.origin.url`
export function resolve(directory: string): Effect.Effect<string | undefined> {
  return Effect.promise(async () => {
    for (const folder of [".kilo", ".kilocode"]) {
      const text = await readFile(path.join(directory, folder, "config.json"), "utf8").catch(() => undefined)
      if (!text) continue
      const parsed = decodeConfigFile(text)
      const id = Option.isSome(parsed) ? parsed.value.project?.id?.trim() : undefined
      if (id) return normalize(id)
    }
    const gitUrl = await execFileAsync("git", ["config", "--get", "remote.origin.url"], {
      cwd: directory,
      timeout: 2_000,
    })
      .then((result) => result.stdout.trim())
      .catch(() => "")
    return gitUrl ? normalize(gitUrl) : undefined
  })
}
