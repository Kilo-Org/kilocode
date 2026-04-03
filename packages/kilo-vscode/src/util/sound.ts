import { exec } from "../util/process"
import * as path from "path"
import * as fs from "fs"

const SOUND_DIR = path.join(__dirname, ".")

export type SoundID =
  | "alert-01"
  | "alert-02"
  | "alert-03"
  | "alert-04"
  | "alert-05"
  | "alert-06"
  | "alert-07"
  | "alert-08"
  | "alert-09"
  | "alert-10"
  | "bip-bop-01"
  | "bip-bop-02"
  | "bip-bop-03"
  | "bip-bop-04"
  | "bip-bop-05"
  | "bip-bop-06"
  | "bip-bop-07"
  | "bip-bop-08"
  | "bip-bop-09"
  | "bip-bop-10"
  | "staplebops-01"
  | "staplebops-02"
  | "staplebops-03"
  | "staplebops-04"
  | "staplebops-05"
  | "staplebops-06"
  | "staplebops-07"
  | "nope-01"
  | "nope-02"
  | "nope-03"
  | "nope-04"
  | "nope-05"
  | "nope-06"
  | "nope-07"
  | "nope-08"
  | "nope-09"
  | "nope-10"
  | "nope-11"
  | "nope-12"
  | "yup-01"
  | "yup-02"
  | "yup-03"
  | "yup-04"
  | "yup-05"
  | "yup-06"

const SOUND_MAP: Record<SoundID, string> = {
  "alert-01": "alert-01.wav",
  "alert-02": "alert-02.wav",
  "alert-03": "alert-03.wav",
  "alert-04": "alert-04.wav",
  "alert-05": "alert-05.wav",
  "alert-06": "alert-06.wav",
  "alert-07": "alert-07.wav",
  "alert-08": "alert-08.wav",
  "alert-09": "alert-09.wav",
  "alert-10": "alert-10.wav",
  "bip-bop-01": "bip-bop-01.wav",
  "bip-bop-02": "bip-bop-02.wav",
  "bip-bop-03": "bip-bop-03.wav",
  "bip-bop-04": "bip-bop-04.wav",
  "bip-bop-05": "bip-bop-05.wav",
  "bip-bop-06": "bip-bop-06.wav",
  "bip-bop-07": "bip-bop-07.wav",
  "bip-bop-08": "bip-bop-08.wav",
  "bip-bop-09": "bip-bop-09.wav",
  "bip-bop-10": "bip-bop-10.wav",
  "staplebops-01": "staplebops-01.wav",
  "staplebops-02": "staplebops-02.wav",
  "staplebops-03": "staplebops-03.wav",
  "staplebops-04": "staplebops-04.wav",
  "staplebops-05": "staplebops-05.wav",
  "staplebops-06": "staplebops-06.wav",
  "staplebops-07": "staplebops-07.wav",
  "nope-01": "nope-01.wav",
  "nope-02": "nope-02.wav",
  "nope-03": "nope-03.wav",
  "nope-04": "nope-04.wav",
  "nope-05": "nope-05.wav",
  "nope-06": "nope-06.wav",
  "nope-07": "nope-07.wav",
  "nope-08": "nope-08.wav",
  "nope-09": "nope-09.wav",
  "nope-10": "nope-10.wav",
  "nope-11": "nope-11.wav",
  "nope-12": "nope-12.wav",
  "yup-01": "yup-01.wav",
  "yup-02": "yup-02.wav",
  "yup-03": "yup-03.wav",
  "yup-04": "yup-04.wav",
  "yup-05": "yup-05.wav",
  "yup-06": "yup-06.wav",
}

const DEFAULT_SOUNDS: Record<string, SoundID> = {
  agent: "alert-01",
  permissions: "bip-bop-01",
  errors: "nope-01",
}

export function resolveSoundId(
  settingValue: string | undefined,
  settingType: "agent" | "permissions" | "errors",
): SoundID | undefined {
  if (!settingValue || settingValue === "none") return undefined

  if (settingValue === "default") {
    return DEFAULT_SOUNDS[settingType]
  }

  if (settingValue in SOUND_MAP) {
    return settingValue as SoundID
  }

  return undefined
}

export async function playSound(soundId: SoundID): Promise<void> {
  const file = SOUND_MAP[soundId]
  if (!file) return

  const filePath = path.join(SOUND_DIR, file)
  if (!fs.existsSync(filePath)) return

  const platform = process.platform

  switch (platform) {
    case "darwin":
      try {
        const { exec: _exec } = await import("child_process")
        await _exec(`afplay "${filePath}"`)
      } catch {
        try {
          const { exec: _exec } = await import("child_process")
          await _exec(`play "${filePath}"`)
        } catch {
          // No audio
        }
      }
      break
    case "linux":
      try {
        const { exec: _exec } = await import("child_process")
        await _exec(`/usr/bin/aplay -f CD "${filePath}"`)
      } catch {
        try {
          const { exec: _exec } = await import("child_process")
          await _exec(`paplay "${filePath}"`)
        } catch {
          try {
            const { exec: _exec } = await import("child_process")
            await _exec(`play "${filePath}"`)
          } catch {
            // No audio
          }
        }
      }
      break
    case "win32":
      try {
        await exec("powershell", [
          "-NonInteractive",
          "-Command",
          `$s = New-Object System.Media.SoundPlayer("${filePath.replace(/\\/g, "\\\\")}"); $s.PlaySync(); $s.Dispose()`,
        ])
      } catch {
        // No audio
      }
      break
  }
}
