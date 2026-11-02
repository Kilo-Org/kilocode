// Reads the machine-wide speech settings. Like v1, only the global config may enable or redirect voice input, so a
// project overlay cannot turn the microphone on or send audio somewhere else.
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { parse } from "jsonc-parser/lib/esm/main.js"
import { KiloConfigFiles } from "@opencode/util/kilocode/config/files"
import { resolveGlobalConfigDir } from "../settings-paths"
import type { SpeechToTextSettings } from "./source"

type Record = { [key: string]: unknown }

export function globalSpeechConfigFiles(env: NodeJS.ProcessEnv, profile: string): string[] {
  const directory = resolveGlobalConfigDir(env, profile)
  return KiloConfigFiles.names.map((name: string) => path.join(directory, name))
}

/** The global file a speech write targets: the first existing write candidate, else the new-file name. */
export function globalSpeechWriteTarget(env: NodeJS.ProcessEnv, profile: string): string {
  const first = globalSpeechConfigFiles(env, profile)[0]
  if (!first) throw new Error("No global Kilo config directory")
  const directory = path.dirname(first)
  const candidates = KiloConfigFiles.writeCandidates(directory, true)
  return candidates.find((file) => existsSync(file)) ?? path.join(directory, KiloConfigFiles.newFile)
}

/**
 * The effective global speech settings. The root files load in `KiloConfigFiles.names` order, where a later file
 * wins, so a value in `kilo2.jsonc` overrides `kilo2.json`. A malformed file is skipped, as core skips it.
 */
export async function readSpeechSettings(input: {
  env: NodeJS.ProcessEnv
  profile: string
}): Promise<SpeechToTextSettings> {
  const settings: SpeechToTextSettings = {}
  for (const file of globalSpeechConfigFiles(input.env, input.profile)) {
    const text = await readFile(file, "utf8").catch(() => undefined)
    if (!text) continue
    const document: unknown = parse(text, [], { allowTrailingComma: true })
    if (!record(document)) continue
    const experimental = document.experimental
    if (!record(experimental)) continue
    apply(settings, "baseUrl", experimental, "speech_to_text_base_url")
    apply(settings, "apiKey", experimental, "speech_to_text_api_key")
    apply(settings, "model", experimental, "speech_to_text_model")
  }
  return settings
}

function apply(
  settings: SpeechToTextSettings,
  key: "baseUrl" | "apiKey" | "model",
  experimental: Record,
  field: string,
) {
  if (!Object.hasOwn(experimental, field)) return
  const value = experimental[field]
  const text = typeof value === "string" ? value.trim() : ""
  // A present null or empty value clears an earlier file's value, matching a removed config key.
  settings[key] = text || undefined
}

function record(value: unknown): value is Record {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
