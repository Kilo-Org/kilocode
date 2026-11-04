import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { globalSpeechConfigFiles, globalSpeechWriteTarget, readSpeechSettings } from "../src/speech-to-text/config"

const dirs: string[] = []

async function configDir(files: Record<string, string>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "kilo-speech-"))
  dirs.push(dir)
  for (const [name, text] of Object.entries(files)) await writeFile(path.join(dir, name), text)
  return dir
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })))
})

describe("readSpeechSettings", () => {
  it("reads the speech keys from the global experimental section", async () => {
    const dir = await configDir({
      "kilo2.json": JSON.stringify({
        experimental: {
          speech_to_text_base_url: " https://speech.test/v1/ ",
          speech_to_text_api_key: " key ",
          speech_to_text_model: " whisper-1 ",
        },
      }),
    })
    expect(await readSpeechSettings({ env: { KILO2_CONFIG_DIR: dir }, profile: "" })).toEqual({
      baseUrl: "https://speech.test/v1/",
      apiKey: "key",
      model: "whisper-1",
    })
  })

  it("lets kilo2.jsonc override kilo2.json, as the config files load", async () => {
    const dir = await configDir({
      "kilo2.json": JSON.stringify({ experimental: { speech_to_text_base_url: "https://first.test" } }),
      "kilo2.jsonc": JSON.stringify({ experimental: { speech_to_text_base_url: "https://second.test" } }),
    })
    expect((await readSpeechSettings({ env: { KILO2_CONFIG_DIR: dir }, profile: "" })).baseUrl).toBe(
      "https://second.test",
    )
  })

  it("treats null and an empty value as cleared", async () => {
    const dir = await configDir({
      "kilo2.json": JSON.stringify({
        experimental: {
          speech_to_text_base_url: "https://speech.test",
          speech_to_text_api_key: "key",
          speech_to_text_model: "whisper-1",
        },
      }),
      "kilo2.jsonc": JSON.stringify({
        experimental: { speech_to_text_base_url: null, speech_to_text_api_key: "", speech_to_text_model: " " },
      }),
    })
    expect(await readSpeechSettings({ env: { KILO2_CONFIG_DIR: dir }, profile: "" })).toEqual({
      baseUrl: undefined,
      apiKey: undefined,
      model: undefined,
    })
  })

  it("skips a malformed document and keeps reading the next one", async () => {
    const dir = await configDir({
      "kilo2.json": "{ this is not json",
      "kilo2.jsonc": JSON.stringify({ experimental: { speech_to_text_model: "whisper-1" } }),
    })
    expect((await readSpeechSettings({ env: { KILO2_CONFIG_DIR: dir }, profile: "" })).model).toBe("whisper-1")
  })

  it("returns no source for a missing config directory", async () => {
    expect(
      await readSpeechSettings({ env: { KILO2_CONFIG_DIR: path.join(os.tmpdir(), "kilo-missing-speech") }, profile: "" }),
    ).toEqual({})
  })

  it("lists both root config files in load order", () => {
    expect(globalSpeechConfigFiles({ KILO2_CONFIG_DIR: "/config" }, "")).toEqual([
      path.join("/config", "kilo2.json"),
      path.join("/config", "kilo2.jsonc"),
    ])
  })

  it("writes the existing jsonc file before json, and creates kilo2.json otherwise", async () => {
    const empty = await configDir({})
    expect(globalSpeechWriteTarget({ KILO2_CONFIG_DIR: empty }, "")).toBe(path.join(empty, "kilo2.json"))

    const json = await configDir({ "kilo2.json": "{}" })
    expect(globalSpeechWriteTarget({ KILO2_CONFIG_DIR: json }, "")).toBe(path.join(json, "kilo2.json"))

    const both = await configDir({ "kilo2.json": "{}", "kilo2.jsonc": "{}" })
    expect(globalSpeechWriteTarget({ KILO2_CONFIG_DIR: both }, "")).toBe(path.join(both, "kilo2.jsonc"))
  })
})
