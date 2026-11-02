import { describe, expect, it } from "bun:test"
import {
  cleanOutput,
  ffmpegCaptureArgs,
  ffmpegPipeArgs,
  macCaptureArgs,
  parseDshowAudioDevices,
  useMacCapture,
} from "../src/speech-to-text/capture"

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
    expect(ffmpegCaptureArgs(["-f", "avfoundation", "-i", ":default"], "/tmp/speech.m4a")).toEqual([
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
    expect(ffmpegPipeArgs("/tmp/speech.m4a")).toEqual([
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
})

describe("cleanOutput", () => {
  it("drops the FFmpeg banner and keeps the diagnostic lines", () => {
    expect(
      cleanOutput(`
ffmpeg version 7.0
built with clang
configuration: --enable-shared
libavutil 59. 8.100
[dshow @ 000] Could not find audio device
`),
    ).toBe("[dshow @ 000] Could not find audio device")
  })
})
