import * as fs from "fs"
import * as path from "path"
import * as vscode from "vscode"
import type { TuiAttentionSoundName } from "@kilocode/plugin/tui"
import { exec } from "../../util/process"
import { playWebviewSound } from "./webview-sound"

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

const ids = new Set<string>(CustomSoundIDs)
const files: Record<TuiAttentionSoundName, CustomSoundID> = {
  default: "bip-bop-01",
  question: "bip-bop-03",
  permission: "staplebops-06",
  error: "nope-03",
  done: "bip-bop-01",
  subagent_done: "yup-01",
}
const fallback: CustomSoundID = "bip-bop-01"

const root = path.join(__dirname, "../audio-wav")
let chain = Promise.resolve(false)
let queued = 0
const limit = 3

export function resolveSoundID(value: string | undefined): AttentionSoundID {
  if (value === "system" || value === "default" || (value && ids.has(value))) return value as AttentionSoundID
  return "default"
}

async function run(commands: Array<{ cmd: string; args: string[]; env?: NodeJS.ProcessEnv }>) {
  for (const command of commands) {
    const ok = await exec(command.cmd, command.args, command.env ? { env: command.env } : {}).then(
      () => true,
      (error) => {
        console.debug("[Kilo New] notification sound command failed", { cmd: command.cmd, error })
        return false
      },
    )
    if (ok) return true
  }
  return false
}

function systemCommands(): Array<{ cmd: string; args: string[] }> {
  if (process.platform === "darwin") return [{ cmd: "osascript", args: ["-e", "beep"] }]
  if (process.platform === "linux") {
    return [
      { cmd: "canberra-gtk-play", args: ["-i", "message-new-instant"] },
      { cmd: "paplay", args: ["/usr/share/sounds/freedesktop/stereo/message.oga"] },
    ]
  }
  if (process.platform === "win32") {
    return [
      {
        cmd: "powershell",
        args: ["-NoProfile", "-NonInteractive", "-Command", "[System.Media.SystemSounds]::Exclamation.Play()"],
      },
    ]
  }
  return []
}

function fileCommands(file: string): Array<{ cmd: string; args: string[]; env?: NodeJS.ProcessEnv }> {
  if (process.platform === "darwin") {
    return [
      { cmd: "afplay", args: [file] },
      { cmd: "play", args: [file] },
    ]
  }
  if (process.platform === "linux") {
    return [
      { cmd: "aplay", args: [file] },
      { cmd: "paplay", args: [file] },
      { cmd: "play", args: [file] },
    ]
  }
  if (process.platform === "win32") {
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
  }
  return []
}

async function perform(name: TuiAttentionSoundName, selected: AttentionSoundID, dir: string) {
  if (vscode.env.remoteName !== undefined) {
    const id = selected === "system" ? fallback : selected === "default" ? files[name] : selected
    const ok = await playWebviewSound(id)
    if (!ok) console.warn("[Kilo New] notification sound has no ready local webview", { name, selected })
    return ok
  }
  if (selected === "system") {
    const ok = await run(systemCommands())
    if (!ok) console.warn("[Kilo New] notification system sound failed", { platform: process.platform })
    return ok
  }
  const id = selected === "default" ? files[name] : selected
  const file = path.resolve(dir, `${id}.wav`)
  if (!file.startsWith(`${path.resolve(dir)}${path.sep}`)) return false
  if (!fs.existsSync(file)) {
    console.warn("[Kilo New] notification sound is missing", { file })
    return false
  }
  const ok = await run(fileCommands(file))
  if (ok) console.debug("[Kilo New] notification sound played", { name, selected })
  else console.warn("[Kilo New] notification sound failed", { name, selected, platform: process.platform })
  return ok
}

export async function playSound(name: TuiAttentionSoundName, selected: AttentionSoundID = "default", dir = root) {
  if (queued >= limit) return false
  queued += 1
  const task = chain.catch(() => false).then(() => perform(name, selected, dir))
  chain = task.finally(() => {
    queued -= 1
  })
  return task
}
