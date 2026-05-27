import { describe, expect, it } from "bun:test"
import { cleanOutput, parseDshowAudioDevices } from "../../src/speech-to-text/capture"

describe("parseDshowAudioDevices", () => {
  it("extracts Windows dshow audio device names", () => {
    const raw = `
[dshow @ 000001] DirectShow audio devices
[dshow @ 000001]  "Microphone Array (Realtek Audio)" (audio)
[dshow @ 000001]  "Webcam Microphone" (audio)
[dshow @ 000001] DirectShow video devices
[dshow @ 000001]  "Integrated Camera" (video)
`

    expect(parseDshowAudioDevices(raw)).toEqual(["Microphone Array (Realtek Audio)", "Webcam Microphone"])
  })

  it("deduplicates repeated dshow audio device names", () => {
    const raw = `"Microphone" (audio)\n"Microphone" (audio)`

    expect(parseDshowAudioDevices(raw)).toEqual(["Microphone"])
  })
})

describe("cleanOutput", () => {
  it("removes ffmpeg build noise from capture errors", () => {
    const raw = `
ffmpeg version 4.2.7 Copyright (c) 2000-2022 the FFmpeg developers
built with gcc 9 (Ubuntu 9.4.0-1ubuntu1~20.04.2)
configuration: --enable-libopus --enable-libx264
libavutil      56. 31.100 / 56. 31.100
ALSA lib ../../../src/pcm/pcm.c:2477:(snd_pcm_open_conf) Unknown field libs
default: Input/output error
`

    expect(cleanOutput(raw)).toBe(
      "ALSA lib ../../../src/pcm/pcm.c:2477:(snd_pcm_open_conf) Unknown field libs\ndefault: Input/output error",
    )
  })
})
