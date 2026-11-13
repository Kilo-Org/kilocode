import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync } from "node:fs"
import path from "node:path"
import {
  CustomSoundIDs,
  DEFAULT_SOUNDS,
  fileCommands,
  playSound,
  resolveSoundID,
  soundDirectory,
  soundFile,
  type AttentionSoundID,
} from "../src/attention/sound"
import { SOUND_OPTIONS, soundChoice } from "../webview-ui/src/components/settings/notifications"

const root = path.resolve(import.meta.dir, "..")
const sounds = soundDirectory(root)
const manifest = (await Bun.file(path.join(root, "package.json")).json()) as {
  contributes: { configuration: { properties: Record<string, { default?: unknown; enum?: string[] }> } }
}
const properties = manifest.contributes.configuration.properties

describe("attention sounds", () => {
  test("the extension ships one WAV file for every sound in the catalog, and no other", () => {
    const files = readdirSync(sounds).filter((file) => file.endsWith(".wav"))
    expect(files.toSorted()).toEqual(CustomSoundIDs.map((id) => `${id}.wav`).toSorted())
    expect(files).toHaveLength(45)
  })

  test("the setting, the host catalog and the Notifications tab offer the same choices", () => {
    const choices = ["default", "system", ...CustomSoundIDs]
    expect(properties["kilo-code.v2.attention.sound"]?.enum).toEqual(choices)
    expect(SOUND_OPTIONS.map((option) => option.value)).toEqual(choices)
  })

  test("every attention setting is off by default and the sound defaults to the per-event set", () => {
    expect(properties["kilo-code.v2.attention.enabled"]?.default).toBe(false)
    expect(properties["kilo-code.v2.attention.notifications"]?.default).toBe(false)
    expect(properties["kilo-code.v2.attention.OSNotifications"]?.default).toBe(false)
    expect(properties["kilo-code.v2.attention.sound"]?.default).toBe("default")
  })

  test("the Settings panel writes, watches and resets the four attention settings", async () => {
    const vscode = await import("vscode")
    const workspace = vscode.workspace as unknown as { getConfiguration: unknown }
    const original = workspace.getConfiguration
    const writes: Array<[string, unknown]> = []
    workspace.getConfiguration = () => ({
      get: () => undefined,
      update: async (key: string, value: unknown) => void writes.push([key, value]),
    })
    try {
      const { KILO_SETTING_KEYS, writeKiloSettings } = await import("../src/settings-host")
      for (const key of ["attention.enabled", "attention.notifications", "attention.OSNotifications", "attention.sound"])
        expect(KILO_SETTING_KEYS as readonly string[]).toContain(key)
      await writeKiloSettings({ "attention.enabled": true, "attention.sound": "nope-02" })
      // A value outside the catalog is never written.
      await writeKiloSettings({ "attention.sound": "../evil" })
      await writeKiloSettings({ "attention.sound": null })
      expect(writes).toEqual([
        ["attention.enabled", true],
        ["attention.sound", "nope-02"],
        ["attention.sound", undefined],
      ])
    } finally {
      workspace.getConfiguration = original
    }
  })

  test("an unknown sound falls back to the default", () => {
    expect(resolveSoundID("nope-12")).toBe("nope-12")
    expect(resolveSoundID("system")).toBe("system")
    expect(resolveSoundID("../../etc/passwd")).toBe("default")
    expect(resolveSoundID(undefined)).toBe("default")
    expect(soundChoice("nope-13")).toBe("default")
  })

  test("the default choice plays a different shipped file per event, and a single choice plays one file", () => {
    expect(soundFile("done", "default", sounds)).toBe(path.join(sounds, "bip-bop-01.wav"))
    expect(soundFile("question", "default", sounds)).toBe(path.join(sounds, "bip-bop-03.wav"))
    expect(soundFile("permission", "default", sounds)).toBe(path.join(sounds, "staplebops-06.wav"))
    expect(soundFile("error", "default", sounds)).toBe(path.join(sounds, "nope-03.wav"))
    expect(soundFile("error", "yup-04", sounds)).toBe(path.join(sounds, "yup-04.wav"))
    expect(soundFile("done", "system", sounds)).toBeUndefined()
    for (const id of Object.values(DEFAULT_SOUNDS)) expect(existsSync(path.join(sounds, `${id}.wav`))).toBe(true)
  })

  test("a choice outside the catalog never builds a path outside the sound directory", () => {
    for (const value of ["../../etc/passwd", "/etc/passwd", "../icon", "nope-13"])
      expect(soundFile("error", value as AttentionSoundID, sounds)).toBe(path.join(sounds, "nope-03.wav"))
  })

  test("each platform plays a file with its own player", () => {
    expect(fileCommands("/a.wav", "darwin").map((item) => item.cmd)).toEqual(["afplay", "play"])
    expect(fileCommands("/a.wav", "linux").map((item) => item.cmd)).toEqual(["aplay", "paplay", "play"])
    const windows = fileCommands("C:\\a'.wav", "win32")[0]
    // The path is data, never script source.
    expect(windows?.args.join(" ")).not.toContain("a'.wav")
    expect(windows?.env?.KILO_SOUND_PATH).toBe("C:\\a'.wav")
  })

  test("a missing sound file plays nothing", async () => {
    expect(await playSound("done", "default", path.join(root, "missing-sounds"))).toBe(false)
  })
})
