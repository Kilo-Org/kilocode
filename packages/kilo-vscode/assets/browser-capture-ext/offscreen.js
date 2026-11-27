let activeTrack = null
let activeEncoder = null
let activeEpoch = 0
let needKey = false

const CODECS = ["avc1.640033", "avc1.640028", "avc1.42e033"]

function toBase64(bytes) {
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

function stopActive() {
  activeEpoch++
  needKey = false
  const track = activeTrack
  const encoder = activeEncoder
  activeTrack = null
  activeEncoder = null
  try {
    track?.stop()
  } catch {}
  try {
    if (encoder && encoder.state !== "closed") encoder.close()
  } catch {}
}

async function pickCodec(width, height) {
  if (typeof VideoEncoder === "undefined") return null
  for (const codec of CODECS) {
    const config = {
      codec,
      width,
      height,
      framerate: 60,
      bitrate: 20_000_000,
      latencyMode: "realtime",
      hardwareAcceleration: "prefer-hardware",
      avc: { format: "annexb" },
    }
    const support = await VideoEncoder.isConfigSupported(config).catch(() => ({ supported: false }))
    if (support.supported) return config
  }
  return null
}

globalThis.__kiloWarmup = async () => {
  const config = await pickCodec(320, 240)
  if (!config) return { supported: false }
  try {
    const canvas = new OffscreenCanvas(320, 240)
    const ctx = canvas.getContext("2d")
    if (ctx) ctx.fillRect(0, 0, 320, 240)
    const enc = new VideoEncoder({ output: () => {}, error: () => {} })
    enc.configure({ ...config, bitrate: 4_000_000 })
    const frame = new VideoFrame(canvas, { timestamp: 0 })
    enc.encode(frame, { keyFrame: true })
    frame.close()
    await enc.flush()
    enc.close()
    return { supported: true, codec: config.codec }
  } catch (error) {
    return { supported: false, error: String(error) }
  }
}

globalThis.__kiloStop = () => {
  stopActive()
  return true
}

globalThis.__kiloKeyFrame = () => {
  needKey = true
  return true
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "capture") return
  ;(async () => {
    stopActive()
    const epoch = msg.epoch
    activeEpoch = epoch
    const width = Math.max(32, msg.width & ~1)
    const height = Math.max(32, msg.height & ~1)
    const config = await pickCodec(width, height)
    if (!config) {
      sendResponse({ ok: false, error: "Hardware H.264 encoder unavailable" })
      return
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: msg.streamId,
          maxFrameRate: 60,
          minFrameRate: 1,
          minWidth: width,
          maxWidth: width,
          minHeight: height,
          maxHeight: height,
        },
      },
    })
    if (activeEpoch !== epoch) {
      for (const t of stream.getTracks()) t.stop()
      sendResponse({ ok: false, error: "Capture superseded" })
      return
    }
    const track = stream.getVideoTracks()[0]
    if (!track) {
      sendResponse({ ok: false, error: "Missing video track" })
      return
    }
    activeTrack = track
    const reader = new MediaStreamTrackProcessor({ track }).readable.getReader()
    const first = await reader.read()
    if (activeEpoch !== epoch || first.done || !first.value) {
      first.value?.close()
      stopActive()
      sendResponse({ ok: false, error: "Capture ended before first frame" })
      return
    }
    const w = first.value.codedWidth & ~1
    const h = first.value.codedHeight & ~1
    const actual = w === width && h === height ? config : await pickCodec(w, h)
    if (!actual) {
      first.value.close()
      stopActive()
      sendResponse({ ok: false, error: "Unsupported captured dimensions" })
      return
    }
    const emit = (kind, ts, data) => {
      if (activeEpoch !== epoch) return
      if (typeof globalThis.__kiloChunk === "function") {
        globalThis.__kiloChunk(`${epoch}:${kind}:${w}x${h}:${Math.round(ts)}:${data}`)
      }
    }
    const encoder = new VideoEncoder({
      output: (chunk) => {
        if (activeEpoch !== epoch) return
        const bytes = new Uint8Array(chunk.byteLength)
        chunk.copyTo(bytes)
        emit(chunk.type === "key" ? "k" : "d", chunk.timestamp, toBase64(bytes))
      },
      error: () => {
        emit("e", 0, "")
        stopActive()
      },
    })
    activeEncoder = encoder
    encoder.configure(actual)
    let index = 0
    const push = (vf) => {
      if (activeEpoch !== epoch || encoder.state !== "configured") {
        vf.close()
        return
      }
      if ((vf.codedWidth & ~1) !== w || (vf.codedHeight & ~1) !== h) {
        vf.close()
        return
      }
      if (encoder.encodeQueueSize > 3) {
        vf.close()
        return
      }
      const keyFrame = index === 0 || needKey
      needKey = false
      index++
      encoder.encode(vf, { keyFrame })
      vf.close()
    }
    push(first.value)
    track.addEventListener("ended", () => {
      if (activeEpoch === epoch) emit("e", 0, "")
    })
    void (async () => {
      try {
        while (activeEpoch === epoch && activeTrack === track) {
          const { value, done } = await reader.read()
          if (done || !value) break
          push(value)
        }
      } catch {
        if (activeEpoch === epoch) emit("e", 0, "")
      }
    })()
    sendResponse({ ok: true, width: w, height: h, codec: actual.codec })
  })().catch((error) => sendResponse({ ok: false, error: String(error) }))
  return true
})
