import { existsSync } from "fs"
import { readFile, stat, unlink } from "fs/promises"
import * as os from "os"
import * as path from "path"
import type { ChildProcess } from "child_process"
import { exec, spawn } from "../util/process"

type Input = {
  requestId: string
  model: string
  language?: string
}

type Recording = Input & {
  file: string
  proc: ChildProcess
  stderr: string[]
  stopped: boolean
  exit?: {
    code: number | null
    signal: string | null
  }
}

type Audio = {
  data: string
  format: "wav"
  model: string
  language?: string
}

let active: Recording | undefined
let starting: string | undefined

export async function startSpeechCapture(input: Input): Promise<boolean> {
  if (active || starting) throw new Error("Speech recording is already in progress")

  starting = input.requestId
  try {
    const bin = await findFFmpeg()
    const file = path.join(os.tmpdir(), `kilo-stt-${process.pid}-${Date.now()}.wav`)
    const state = await startWithArgs(bin, file, input, await inputArgSets(bin))
    return !state.stopped
  } finally {
    if (starting === input.requestId) starting = undefined
  }
}

export async function stopSpeechCapture(requestId: string): Promise<Audio> {
  const state = requireActive(requestId)
  state.stopped = true
  active = undefined

  await stopProcess(state)

  const size = await stat(state.file)
    .then((info) => info.size)
    .catch((err: unknown) => {
      console.warn("[Kilo New] Failed to stat speech recording", err)
      return 0
    })

  if (size < 44) {
    await removeFile(state.file)
    throw new Error(summary(state, "No audio was recorded"))
  }

  const file = await readFile(state.file)
  await removeFile(state.file)
  return { data: file.toString("base64"), format: "wav", model: state.model, language: state.language }
}

export async function cancelSpeechCapture(requestId: string): Promise<void> {
  const state = active
  if (!state || state.requestId !== requestId) return
  state.stopped = true
  active = undefined
  await stopProcess(state)
  await removeFile(state.file)
}

async function waitForStart(state: Recording): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const done = () => {
      state.proc.off("error", onError)
      state.proc.off("exit", onExit)
      state.proc.stderr?.off("data", onData)
      clearTimeout(timer)
      resolve()
    }
    const onError = (err: Error) => {
      state.proc.off("exit", onExit)
      state.proc.stderr?.off("data", onData)
      clearTimeout(timer)
      reject(err)
    }
    const onExit = () => {
      if (state.stopped) {
        done()
        return
      }
      onError(new Error(summary(state, "Could not start microphone recording")))
    }
    const onData = (data: Buffer) => {
      if (/Output #0|Press \[q\]|size=\s*\d+/i.test(data.toString())) done()
    }
    const timer = setTimeout(() => {
      onError(new Error(summary(state, "Timed out starting microphone recording")))
    }, 5000)

    state.proc.stderr?.on("data", onData)
    state.proc.once("error", onError)
    state.proc.once("exit", onExit)
  }).catch(async (err: unknown) => {
    if (active === state) active = undefined
    await stopProcess(state)
    await removeFile(state.file)
    throw err
  })
}

async function startWithArgs(bin: string, file: string, input: Input, args: string[][]): Promise<Recording> {
  const [first, ...rest] = args
  if (!first) throw new Error(`Unsupported platform for speech input: ${process.platform}`)

  const proc = spawn(bin, ["-y", ...first, "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", "-f", "wav", file], {
    stdio: ["pipe", "ignore", "pipe"],
  })
  const state: Recording = { ...input, file, proc, stderr: [], stopped: false }
  active = state

  proc.stderr?.on("data", (data: Buffer) => {
    if (state.stderr.length < 20) state.stderr.push(data.toString())
  })
  proc.on("exit", (code, signal) => {
    state.exit = { code, signal }
    if (active === state && !state.stopped) active = undefined
  })
  proc.on("error", (err) => {
    state.stderr.push(err.message)
    if (active === state && !state.stopped) active = undefined
  })

  try {
    await waitForStart(state)
    return state
  } catch (err) {
    if (state.stopped) return state
    if (rest.length === 0) throw err
    return startWithArgs(bin, file, input, rest)
  }
}

async function stopProcess(state: Recording): Promise<void> {
  if (state.proc.exitCode !== null || state.proc.signalCode) return

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (!state.proc.killed) state.proc.kill("SIGKILL")
      resolve()
    }, 2000)

    state.proc.once("exit", () => {
      clearTimeout(timer)
      resolve()
    })

    if (state.proc.stdin?.writable) {
      state.proc.stdin.write("q")
      state.proc.stdin.end()
      return
    }

    state.proc.kill("SIGTERM")
  })
}

function requireActive(requestId: string): Recording {
  if (!active || active.requestId !== requestId) throw new Error("No active speech recording")
  return active
}

async function findFFmpeg(): Promise<string> {
  const paths = [
    process.env.KILO_FFMPEG_PATH,
    process.env.FFMPEG_PATH,
    bundledPath(),
    ...platformPaths(),
    "ffmpeg",
  ].filter(Boolean)

  for (const bin of paths) {
    if (!bin) continue
    if (path.isAbsolute(bin) && !existsSync(bin)) continue
    try {
      await exec(bin, ["-version"], { timeout: 3000 })
      return bin
    } catch (err) {
      console.warn(`[Kilo New] FFmpeg candidate failed: ${bin}`, err)
    }
  }

  throw new Error("Speech input needs the bundled FFmpeg helper, but it was not found. Rebuild or reinstall Kilo Code.")
}

function bundledPath(): string {
  return path.join(__dirname, "..", "bin", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg")
}

function platformPaths(): string[] {
  if (process.platform === "darwin")
    return ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/opt/local/bin/ffmpeg"]
  if (process.platform === "win32") {
    return [
      "C:\\ffmpeg\\bin\\ffmpeg.exe",
      process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "ffmpeg", "bin", "ffmpeg.exe") : undefined,
      process.env["ProgramFiles(x86)"]
        ? path.join(process.env["ProgramFiles(x86)"], "ffmpeg", "bin", "ffmpeg.exe")
        : undefined,
      process.env.USERPROFILE
        ? path.join(process.env.USERPROFILE, "scoop", "apps", "ffmpeg", "current", "bin", "ffmpeg.exe")
        : undefined,
      "C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe",
    ].filter((item): item is string => !!item)
  }
  return ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/snap/bin/ffmpeg", "/home/linuxbrew/.linuxbrew/bin/ffmpeg"]
}

async function inputArgSets(bin: string): Promise<string[][]> {
  if (process.platform === "darwin") return [["-f", "avfoundation", "-i", ":default"]]
  if (process.platform === "linux")
    return [
      ["-f", "pulse", "-i", "default"],
      ["-f", "alsa", "-i", "default"],
    ]
  if (process.platform === "win32") return await windowsInputArgSets(bin)
  return []
}

async function windowsInputArgSets(bin: string): Promise<string[][]> {
  const configured = process.env.KILO_FFMPEG_AUDIO_DEVICE
  if (configured) return [["-f", "dshow", "-i", `audio=${configured}`]]

  const devices = await listDshowAudioDevices(bin)
  if (devices.length === 0) throw new Error("No Windows audio input devices found for speech input")
  return devices.map((device) => ["-f", "dshow", "-i", `audio=${device}`])
}

async function listDshowAudioDevices(bin: string): Promise<string[]> {
  const raw = await exec(bin, ["-list_devices", "true", "-f", "dshow", "-i", "dummy"], { timeout: 5000 })
    .then((result) => `${result.stdout}\n${result.stderr}`)
    .catch((err: unknown) => processOutput(err))
  return parseDshowAudioDevices(raw)
}

export function parseDshowAudioDevices(raw: string): string[] {
  const devices = new Set<string>()
  for (const match of raw.matchAll(/"([^"]+)"\s+\(audio\)/g)) devices.add(match[1]!)
  return [...devices]
}

function processOutput(err: unknown): string {
  if (!err || typeof err !== "object") return ""
  const result = err as { stdout?: unknown; stderr?: unknown }
  return `${typeof result.stdout === "string" ? result.stdout : ""}\n${typeof result.stderr === "string" ? result.stderr : ""}`
}

function summary(state: Recording, fallback: string): string {
  const stderr = state.stderr.join("\n").trim()
  if (!stderr) return fallback
  return `${fallback}: ${stderr.slice(-800)}`
}

async function removeFile(file: string): Promise<void> {
  await unlink(file).catch((err: unknown) => {
    console.warn("[Kilo New] Failed to remove speech recording", err)
  })
}
