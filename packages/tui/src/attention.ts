/// <reference path="./audio.d.ts" />
import { execFile, execSync } from "node:child_process"
import type {
  TuiAttention,
  TuiAttentionNotifyInput,
  TuiAttentionNotifyResult,
  TuiAttentionNotifySkipReason,
  TuiAttentionWhen,
  TuiKV,
  TuiAttentionSoundName,
  TuiAttentionSoundPack,
  TuiAttentionSoundPackInfo,
} from "@kilocode/plugin/tui"

/** 
 * Captured at module load so notification click can refocus the terminal window.
 * Only runs on Linux to avoid blocking startup on other platforms.
 */
let TERMINAL_WINDOW_ID: string | undefined
let TERMINAL_DESKTOP_ID: string | undefined
if (process.platform === "linux") {
  try {
    TERMINAL_WINDOW_ID = execSync("xdotool getactivewindow", { encoding: "utf-8" }).trim()
    if (TERMINAL_WINDOW_ID) {
      TERMINAL_DESKTOP_ID = execSync(`xdotool get_desktop_for_window ${TERMINAL_WINDOW_ID}`, { encoding: "utf-8" }).trim()
    }
  } catch {
    // xdotool not available; window focus on click will be skipped
  }
}

import { AttentionSoundName, type TuiConfig } from "./config"
import { Schema } from "effect"
import stripAnsi from "strip-ansi"
import * as TuiAudio from "./audio"
import defaultSoundPath from "@opencode-ai/ui/audio/bip-bop-01.mp3" with { type: "file" }
import questionSoundPath from "@opencode-ai/ui/audio/bip-bop-03.mp3" with { type: "file" }
import permissionSoundPath from "@opencode-ai/ui/audio/staplebops-06.mp3" with { type: "file" }
import errorSoundPath from "@opencode-ai/ui/audio/nope-03.mp3" with { type: "file" }
import doneSoundPath from "@opencode-ai/ui/audio/bip-bop-01.mp3" with { type: "file" }
import subagentDoneSoundPath from "@opencode-ai/ui/audio/yup-01.mp3" with { type: "file" }

type FocusState = "unknown" | "focused" | "blurred"

type AttentionRenderer = {
  readonly isDestroyed: boolean
  on(event: "focus" | "blur", listener: () => void): unknown
  off(event: "focus" | "blur", listener: () => void): unknown
  triggerNotification(message: string, title?: string): boolean
}

type RegisteredSoundPack = TuiAttentionSoundPack & {
  builtin: boolean
}

type TuiAttentionHost = TuiAttention & {
  dispose(): void
}

const DEFAULT_TITLE = "Kilo" // kilocode_change
const DEFAULT_PACK_ID = "kilo.default" // kilocode_change
const KV_SOUND_PACK = "attention_sound_pack"
const TITLE_LIMIT = 80
const MESSAGE_LIMIT = 240
const BUILTIN_PACK: RegisteredSoundPack = {
  id: DEFAULT_PACK_ID,
  name: "Kilo Default", // kilocode_change
  builtin: true,
  sounds: {
    default: defaultSoundPath,
    question: questionSoundPath,
    permission: permissionSoundPath,
    error: errorSoundPath,
    done: doneSoundPath,
    subagent_done: subagentDoneSoundPath,
  },
}

function skipped(reason: TuiAttentionNotifySkipReason): TuiAttentionNotifyResult {
  return {
    ok: false,
    notification: false,
    sound: false,
    skipped: reason,
  }
}

function normalizeText(input: string | undefined, fallback: string, limit: number) {
  const text = stripAnsi(input ?? "")
    .replace(/[ \t]*[\r\n]+[ \t]*/g, " ")
    .replace(/[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
    .trim()
  const normalized = text.length ? text : fallback
  return Array.from(normalized).slice(0, limit).join("")
}

function clampVolume(volume: number) {
  if (!Number.isFinite(volume)) return 0
  return Math.min(1, Math.max(0, volume))
}

function soundVolume(input: TuiAttentionNotifyInput, config: Pick<TuiConfig.Resolved, "attention">, soundEnabled: boolean) {
  if (!soundEnabled) return
  if (input.sound === false) return
  if (input.sound === undefined) return clampVolume(config.attention.volume)
  if (input.sound === true) return clampVolume(config.attention.volume)
  return clampVolume(input.sound.volume ?? config.attention.volume)
}

function normalizePack(pack: TuiAttentionSoundPack): RegisteredSoundPack | undefined {
  const id = pack.id.trim()
  if (!id) return
  return {
    id,
    name: pack.name?.trim() || undefined,
    builtin: false,
    sounds: Object.fromEntries(
      Object.entries(pack.sounds).filter(
        (item): item is [TuiAttentionSoundName, string] =>
          Schema.is(AttentionSoundName)(item[0]) && typeof item[1] === "string" && item[1].trim().length > 0,
      ),
    ),
  }
}

function focusSkip(when: TuiAttentionWhen, focus: FocusState) {
  if (when === "always") return
  if (focus === "unknown") return "focus_unknown"
  if (when === "blurred" && focus === "focused") return "focused"
  if (when === "focused" && focus === "blurred") return "blurred"
}

export function createTuiAttention(input: {
  renderer: AttentionRenderer
  config: Pick<TuiConfig.Resolved, "attention">
  kv?: TuiKV
  audio?: Pick<typeof TuiAudio, "loadSoundFile" | "play">
}): TuiAttentionHost {
  let focus: FocusState = "unknown"
  let disposed = false
  let activePackID: string | undefined
  const packs = new Map<string, RegisteredSoundPack>([[BUILTIN_PACK.id, BUILTIN_PACK]])
  const audio = input.audio ?? TuiAudio

  const onFocus = () => {
    focus = "focused"
  }
  const onBlur = () => {
    focus = "blurred"
  }

  input.renderer.on("focus", onFocus)
  input.renderer.on("blur", onBlur)

  function configuredPackID() {
    const stored = input.kv?.get<string | undefined>(KV_SOUND_PACK, undefined)
    return activePackID ?? stored ?? input.config.attention.sound_pack
  }

  function currentPack() {
    return packs.get(configuredPackID()) ?? BUILTIN_PACK
  }

  function soundCandidates(name: TuiAttentionSoundName) {
    return [input.config.attention.sounds[name], currentPack().sounds[name], BUILTIN_PACK.sounds[name]].filter(
      (item, index, list): item is string => typeof item === "string" && list.indexOf(item) === index,
    )
  }

  async function playSound(name: TuiAttentionSoundName, volume: number) {
    try {
      for (const file of soundCandidates(name)) {
        const current = await audio.loadSoundFile(file).catch((error) => {
          console.debug("failed to load attention sound", { file, error })
          return null
        })
        if (disposed) return false
        if (current == null) continue
        if (audio.play(current, { volume }) != null) return true
      }
      return false
    } catch (error) {
      console.debug("failed to play attention sound", { error })
      return false
    }
  }

  return {
    async notify(request) {
      try {
        if (!input.config.attention.enabled) return skipped("attention_disabled")
        if (disposed || input.renderer.isDestroyed) return skipped("renderer_destroyed")

        const message = normalizeText(request.message, "", MESSAGE_LIMIT)
        if (!message) return skipped("empty_message")

        const soundEnabled = (input.kv?.get<boolean>("attention.sound") ?? input.config.attention.sound) as boolean
        const notifyEnabled = (input.kv?.get<boolean>("attention.notifications") ?? input.config.attention.notifications) as boolean

        const requestedNotification = typeof request.notification === "object" ? request.notification : undefined
        const notificationSkip = focusSkip(requestedNotification?.when ?? "blurred", focus)
        const notificationRequested = notifyEnabled && request.notification !== false
        const shouldNotify = notificationRequested && !notificationSkip

        // 1. Calculate sound settings
        const volume = soundVolume(request, input.config, soundEnabled)
        const requestedSound = typeof request.sound === "object" ? request.sound : undefined
        const soundSkip = volume === undefined ? undefined : focusSkip(requestedSound?.when ?? "always", focus)
        const soundName =
          requestedSound?.name && Schema.is(AttentionSoundName)(requestedSound.name) ? requestedSound.name : "default"

        // 2. Prepare Notification Promise
        let notificationPromise: Promise<boolean> = Promise.resolve(false)
        if (shouldNotify) {
          const title = normalizeText(request.title, DEFAULT_TITLE, TITLE_LIMIT)
          if (process.platform === "linux") {
            notificationPromise = new Promise<boolean>((resolve) => {
              execFile(
                "notify-send",
                ["--action=default=Open", title, message],
                { env: process.env, timeout: 5000 },
                (err, stdout) => {
                  try {
                    if (err) {
                      console.debug("notify-send failed", { error: err })
                      const isTimeout = err.killed || Boolean(err.signal)
                      
                      // If the process timed out, the popup likely appeared and is waiting to be dismissed.
                      // If it's any other error (missing binary, D-Bus down), fallback to the renderer.
                      if (!isTimeout) {
                        resolve(input.renderer.triggerNotification(message, title))
                      } else {
                        resolve(false)
                      }
                      return
                    }
                    if (stdout?.trim() === "default" && TERMINAL_WINDOW_ID) {
                      // First, switch to the workspace where the terminal is located
                      if (TERMINAL_DESKTOP_ID) {
                        execFile("xdotool", ["set_desktop", TERMINAL_DESKTOP_ID], () => {})
                      }
                      // Then, activate the terminal window itself
                      execFile("xdotool", ["windowactivate", TERMINAL_WINDOW_ID], () => {})
                    }
                    resolve(true)
                  } catch (callbackErr) {
                    console.debug("notify-send callback error", { error: callbackErr })
                    resolve(false)
                  }
                }
              )
            })
          } else {
            notificationPromise = Promise.resolve(input.renderer.triggerNotification(message, title))
          }
        }

        // 3. Prepare Sound Promise
        const soundPromise =
          volume === undefined || soundSkip ? Promise.resolve(false) : playSound(soundName, volume)

        // 4. Execute both concurrently to prevent sound delay
        const [notification, sound] = await Promise.all([notificationPromise, soundPromise])

        if (!notification && !sound) {
          if (notificationRequested && notificationSkip) return skipped(notificationSkip)
          if (soundSkip) return skipped(soundSkip)
        }

        return {
          ok: notification || sound,
          notification,
          sound,
        }
      } catch (error) {
        console.debug("failed to handle attention notification", { error })
        return {
          ok: false,
          notification: false,
          sound: false,
        }
      }
    },
    soundboard: {
      registerPack(pack) {
        const next = normalizePack(pack)
        if (!next) return () => {}
        packs.set(next.id, next)
        let disposed = false
        return () => {
          if (disposed) return
          disposed = true
          if (packs.get(next.id) === next) packs.delete(next.id)
        }
      },
      activate(id, options) {
        const pack = packs.get(id)
        if (!pack) return false
        activePackID = pack.id
        if (options?.persist) input.kv?.set(KV_SOUND_PACK, pack.id)
        return true
      },
      current() {
        return currentPack().id
      },
      list(): TuiAttentionSoundPackInfo[] {
        const current = currentPack().id
        return Array.from(packs.values()).map((pack) => ({
          id: pack.id,
          name: pack.name,
          active: pack.id === current,
          builtin: pack.builtin,
        }))
      },
    },
    dispose() {
      if (disposed) return
      disposed = true
      input.renderer.off("focus", onFocus)
      input.renderer.off("blur", onBlur)
    },
  }
}
