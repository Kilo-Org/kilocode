import { describe, expect, it } from "bun:test"
import { parseDshowAudioDevices } from "../../src/speech-to-text/capture"

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
