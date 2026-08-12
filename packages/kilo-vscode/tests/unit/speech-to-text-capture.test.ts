import { describe, expect, it } from "bun:test"
import {
  cleanOutput,
  ffmpegCaptureArgs,
  ffmpegPipeArgs,
  macCaptureArgs,
  parseDshowAudioDevices,
  useMacCapture,
} from "../../src/speech-to-text/capture"

describe("macCaptureArgs", () => {
  it("records 16 kHz mono AAC at 24 kbps with the built-in AVFoundation bridge", () => {
    const args = macCaptureArgs("/tmp/speech.m4a")

    expect(args.slice(0, 3)).toEqual(["-l", "JavaScript", "-e"])
    expect(args.at(-1)).toBe("/tmp/speech.m4a")
    expect(args[3]).toContain("AVAudioRecorder")
    expect(args[3]).toContain("numberWithUnsignedInt(1633772320), $.AVFormatIDKey")
    expect(args[3]).toContain("numberWithDouble(16000), $.AVSampleRateKey")
    expect(args[3]).toContain("numberWithInt(1), $.AVNumberOfChannelsKey")
    expect(args[3]).toContain("numberWithInt(24000), $.AVEncoderBitRateKey")
    expect(args[3]).toContain("error[0] && error[0].localizedDescription")
    expect(args[3]).toContain('console.log("ready")')
  })
})

describe("ffmpeg args", () => {
  it("builds AAC capture arguments with faststart", () => {
    const args = ffmpegCaptureArgs(["-f", "avfoundation", "-i", ":default"], "/tmp/speech.m4a")

    expect(args).toEqual([
      "-y",
      "-f",
      "avfoundation",
      "-i",
      ":default",
      "-c:a",
      "aac",
      "-b:a",
      "24k",
      "-ar",
      "16000",
      "-ac",
      "1",
      "-movflags",
      "+faststart",
      "/tmp/speech.m4a",
    ])
  })

  it("builds pipe capture arguments for Linux PipeWire", () => {
    const args = ffmpegPipeArgs("/tmp/speech.m4a")

    expect(args).toEqual([
      "-y",
      "-f",
      "s16le",
      "-ar",
      "16000",
      "-ac",
      "1",
      "-i",
      "pipe:0",
      "-c:a",
      "aac",
      "-b:a",
      "24k",
      "-ar",
      "16000",
      "-ac",
      "1",
      "-movflags",
      "+faststart",
      "/tmp/speech.m4a",
    ])
  })
})

describe("useMacCapture", () => {
  it("preserves explicit FFmpeg overrides", () => {
    expect(useMacCapture("darwin", {})).toBe(true)
    expect(useMacCapture("darwin", { KILO_FFMPEG_PATH: "/custom/ffmpeg" })).toBe(false)
    expect(useMacCapture("darwin", { FFMPEG_PATH: "/custom/ffmpeg" })).toBe(false)
    expect(useMacCapture("linux", {})).toBe(false)
    expect(useMacCapture("win32", {})).toBe(false)
  })
})

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

  it("extracts section-listed Windows dshow audio device names", () => {
    const raw = `
[dshow @ 000001] DirectShow video devices (some may be both video and audio devices)
[dshow @ 000001]  "OBS Virtual Camera"
[dshow @ 000001]     Alternative name "@device_video"
[dshow @ 000001] DirectShow audio devices
[dshow @ 000001]  "Headset (2- Bose QuietComfort 35 Series II)"
[dshow @ 000001]     Alternative name "@device_headset"
[dshow @ 000001]  "Microphone (MSI Sound Tune)"
[dshow @ 000001]     Alternative name "@device_microphone"
[dshow @ 000001]  "Alternative name Microphone"
[dshow @ 000001]     Alternative name "@device_alternative"
`

    expect(parseDshowAudioDevices(raw)).toEqual([
      "Headset (2- Bose QuietComfort 35 Series II)",
      "Microphone (MSI Sound Tune)",
      "Alternative name Microphone",
    ])
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
