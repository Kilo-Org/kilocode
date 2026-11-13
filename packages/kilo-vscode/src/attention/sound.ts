// The attention sound catalog and its playback, as on v1 (packages/kilo-vscode/src/services/attention/sound.ts on
// main). The WAV files ship in `assets/audio-wav`; each platform plays them with its own command-line player, so the
// extension needs no native dependency.
import { existsSync } from "node:fs"
import path from "node:path"
import { exec } from "../process"

export const CustomSoundIDs = [
  "alert-01",
  "alert-02",
  "alert-03",
  "alert-04",
  "alert-05",
  "alert-06",
  "alert-07",
  "alert-08",
  "alert-09",
  "alert-10",
  "bip-bop-01",
  "bip-bop-02",
  "bip-bop-03",
  "bip-bop-04",
  "bip-bop-05",
  "bip-bop-06",
  "bip-bop-07",
  "bip-bop-08",
  "bip-bop-09",
  "bip-bop-10",
  "staplebops-01",
  "staplebops-02",
  "staplebops-03",
  "staplebops-04",
  "staplebops-05",
  "staplebops-06",
  "staplebops-07",
  "nope-01",
  "nope-02",
  "nope-03",
  "nope-04",
  "nope-05",
  "nope-06",
  "nope-07",
  "nope-08",
  "nope-09",
  "nope-10",
  "nope-11",
  "nope-12",
  "yup-01",
  "yup-02",
  "yup-03",
  "yup-04",
  "yup-05",
  "yup-06",
] as const

export type CustomSoundID = (typeof CustomSoundIDs)[number]
export type AttentionSoundID = "default" | "system" | CustomSoundID
/** The event a sound announces. `default` is the preview of the default choice. */
export type AttentionSoundName = "default" | "done" | "question" | "permission" | "error"

const ids = new Set<string>(CustomSoundIDs)

/** The per-event files of the `default` choice. */
export const DEFAULT_SOUNDS: Record<AttentionSoundName, CustomSoundID> = {
  default: "bip-bop-01",
  question: "bip-bop-03",
  permission: "staplebops-06",
  error: "nope-03",
  done: "bip-bop-01",
}

type Command = { cmd: string; args: string[]; env?: NodeJS.ProcessEnv }

let chain = Promise.resolve(false)
let queued = 0
const limit = 3

/** The WAV files of the sound catalog, shipped in the extension. */
export function soundDirectory(extensionPath: string) {
  return path.join(extensionPath, "assets", "audio-wav")
}

export function resolveSoundID(value: unknown): AttentionSoundID {
  if (value === "system" || value === "default") return value
  if (typeof value === "string" && ids.has(value)) return value as CustomSoundID
  return "default"
}

/**
 * The file a choice plays for an event, or undefined for the system sound. The choice is checked against the catalog
 * here, next to the path it builds, so only a shipped file in `dir` can ever be played.
 */
export function soundFile(name: AttentionSoundName, selected: AttentionSoundID, dir: string): string | undefined {
  const id = resolveSoundID(selected)
  if (id === "system") return undefined
  return path.join(dir, `${id === "default" ? DEFAULT_SOUNDS[name] : id}.wav`)
}

/**
 * Plays the sound for one event. Playback is serialized with a small cap, so a burst of events cannot pile up player
 * processes. Resolves true when a player command succeeded.
 */
export function playSound(name: AttentionSoundName, selected: AttentionSoundID, dir: string): Promise<boolean> {
  if (queued >= limit) return Promise.resolve(false)
  queued += 1
  const task = chain.catch(() => false).then(() => perform(name, selected, dir))
  chain = task.finally(() => {
    queued -= 1
  })
  return task
}

async function perform(name: AttentionSoundName, selected: AttentionSoundID, dir: string) {
  const file = soundFile(name, selected, dir)
  if (!file) return run(systemCommands(process.platform))
  if (!existsSync(file)) {
    console.warn("[Kilo] notification sound is missing", { file })
    return false
  }
  return run(fileCommands(file, process.platform))
}

async function run(commands: Command[]) {
  for (const command of commands) {
    const ok = await exec(command.cmd, command.args, command.env ? { env: command.env } : {}).then(
      () => true,
      (error: unknown) => {
        console.debug("[Kilo] notification sound command failed", { cmd: command.cmd, error })
        return false
      },
    )
    if (ok) return true
  }
  return false
}

export function systemCommands(platform: NodeJS.Platform): Command[] {
  if (platform === "darwin") return [{ cmd: "osascript", args: ["-e", "beep"] }]
  if (platform === "linux")
    return [
      { cmd: "canberra-gtk-play", args: ["-i", "message-new-instant"] },
      { cmd: "paplay", args: ["/usr/share/sounds/freedesktop/stereo/message.oga"] },
    ]
  if (platform === "win32")
    return [
      {
        cmd: "powershell",
        args: ["-NoProfile", "-NonInteractive", "-Command", "[System.Media.SystemSounds]::Exclamation.Play()"],
      },
    ]
  return []
}

export function fileCommands(file: string, platform: NodeJS.Platform): Command[] {
  if (platform === "darwin")
    return [
      { cmd: "afplay", args: [file] },
      { cmd: "play", args: [file] },
    ]
  if (platform === "linux")
    return [
      { cmd: "aplay", args: [file] },
      { cmd: "paplay", args: [file] },
      { cmd: "play", args: [file] },
    ]
  // The path is passed as environment data, never interpolated into the script.
  if (platform === "win32")
    return [
      {
        cmd: "powershell",
        args: [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "$sound = [System.Media.SoundPlayer]::new($env:KILO_SOUND_PATH); $sound.PlaySync(); $sound.Dispose()",
        ],
        env: { ...process.env, KILO_SOUND_PATH: file },
      },
    ]
  return []
}
