// Resolves and launches the bundled Swift voice sidecar for `--voice local`.
// Builds from source on first run (dev/experimental gate); the sidecar speaks
// the Voice Helper Protocol so it plugs into the same adapter as a scripted
// helper.

import path from "path"
import { existsSync } from "fs"
import { fileURLToPath } from "url"
import { createSidecarVoice } from "./sidecar"
import type { VoiceAdapter } from "./adapter"

export type LocalVoiceOpts = {
  activation: "continuous" | "push-to-talk"
  silenceMs?: number
}

export class LocalVoiceUnavailable extends Error {}

/** Locate `packages/kilo-voice-sidecar`. Honors KILO_VOICE_SIDECAR_DIR override. */
export function resolveSidecarDir(): string {
  const override = process.env["KILO_VOICE_SIDECAR_DIR"]
  if (override) return override
  const here = path.dirname(fileURLToPath(import.meta.url)) // .../src/kilocode/design/voice
  return path.resolve(here, "../../../../../kilo-voice-sidecar")
}

export function createLocalVoice(opts: LocalVoiceOpts): VoiceAdapter {
  if (process.platform !== "darwin") {
    throw new LocalVoiceUnavailable(
      "local voice (Apple Speech) is macOS-only. Use --voice fake, or --voice local --voice-helper-command \"<cmd>\".",
    )
  }
  const dir = resolveSidecarDir()
  if (!existsSync(path.join(dir, "Package.swift"))) {
    throw new LocalVoiceUnavailable(
      `voice sidecar package not found at ${dir}. Set KILO_VOICE_SIDECAR_DIR or use --voice-helper-command.`,
    )
  }
  const flags = ["--activation", opts.activation, ...(opts.silenceMs ? ["--silence-ms", String(opts.silenceMs)] : [])]

  // Prefer the prebuilt binary: fewer nested processes means cleaner microphone
  // permission attribution, and no surprise rebuild mid-session. Fall back to
  // `swift run` (which builds on demand) if it hasn't been built yet.
  const binary = path.join(dir, ".build", "debug", "kilo-voice-sidecar")
  const command = existsSync(binary)
    ? [binary, ...flags]
    : ["swift", "run", "--quiet", "kilo-voice-sidecar", ...flags]

  return createSidecarVoice({ command, cwd: dir, shell: false, activation: opts.activation })
}
