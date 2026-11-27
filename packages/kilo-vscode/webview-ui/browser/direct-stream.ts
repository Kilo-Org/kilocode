import {
  decodeStreamFrame,
  encodeStreamControl,
  encodeStreamWheel,
  STREAM_CODECS,
  STREAM_FRAME_H264_DELTA,
  STREAM_FRAME_H264_KEY,
  STREAM_FRAME_JPEG,
  STREAM_INPUT_FALLBACK_JPEG,
  STREAM_INPUT_KEYFRAME,
  type StreamPacket,
} from "../../src/shared/browser-stream"

export interface DirectFrameMeta {
  width: number
  height: number
  navigation: number
  revision: number
  sequence: number
}

const INPUT_BUFFER_CAP = 64 * 1024

export class DirectStream {
  private ws?: WebSocket
  private url?: string
  private decoder?: VideoDecoder
  private decoderKey?: string
  private decodeGen = 0
  private awaitingKey = true
  private keyRequestedAt = 0
  private forceJpeg = false
  private tsCounter = 0
  private readonly metaByTs = new Map<number, DirectFrameMeta>()
  private jpegDecoding = false
  private pendingJpeg?: StreamPacket
  private disposed = false

  constructor(
    private readonly isAccepted: (meta: Pick<DirectFrameMeta, "navigation" | "revision">) => boolean,
    private readonly onFrame: (source: CanvasImageSource, meta: DirectFrameMeta) => void,
  ) {}

  get open(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  connect(url: string | undefined): void {
    if (this.disposed || url === this.url) return
    this.closeSocket()
    this.reset()
    this.url = url
    if (!url || typeof WebSocket === "undefined") return
    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch {
      return
    }
    ws.binaryType = "arraybuffer"
    this.ws = ws
    ws.onmessage = (event) => {
      if (this.ws !== ws || !(event.data instanceof ArrayBuffer)) return
      this.handlePacket(event.data)
    }
    ws.onclose = () => {
      if (this.ws === ws) this.ws = undefined
    }
    ws.onerror = () => {
      if (this.ws === ws) ws.close()
    }
  }

  reset(): void {
    this.decodeGen++
    this.awaitingKey = true
    this.keyRequestedAt = 0
    this.pendingJpeg = undefined
    this.metaByTs.clear()
    this.closeDecoder()
  }

  sendWheel(input: {
    navigation: number
    revision: number
    x: number
    y: number
    deltaX: number
    deltaY: number
    modifiers: number
  }): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.ws.bufferedAmount > INPUT_BUFFER_CAP) return false
    this.ws.send(encodeStreamWheel(input))
    return true
  }

  dispose(): void {
    this.disposed = true
    this.closeSocket()
    this.reset()
  }

  private closeSocket(): void {
    const ws = this.ws
    this.ws = undefined
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) ws.close()
  }

  private closeDecoder(): void {
    const decoder = this.decoder
    this.decoder = undefined
    this.decoderKey = undefined
    if (!decoder || decoder.state === "closed") return
    try {
      decoder.close()
    } catch {}
  }

  private sendControl(kind: 2 | 3, navigation: number, revision: number): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encodeStreamControl(kind, navigation, revision))
  }

  private fallbackJpeg(navigation: number, revision: number): void {
    this.forceJpeg = true
    this.closeDecoder()
    this.metaByTs.clear()
    this.sendControl(STREAM_INPUT_FALLBACK_JPEG, navigation, revision)
  }

  private handlePacket(buffer: ArrayBuffer): void {
    const packet = decodeStreamFrame(buffer)
    if (!packet || !this.isAccepted(packet)) return
    if (packet.kind === STREAM_FRAME_JPEG) {
      this.handleJpeg(packet)
      return
    }
    if (packet.kind === STREAM_FRAME_H264_KEY || packet.kind === STREAM_FRAME_H264_DELTA) {
      this.handleH264(packet)
    }
  }

  private requestKeyframe(navigation: number, revision: number): void {
    const now = performance.now()
    if (now - this.keyRequestedAt < 250) return
    this.keyRequestedAt = now
    this.sendControl(STREAM_INPUT_KEYFRAME, navigation, revision)
  }

  private handleH264(packet: StreamPacket): void {
    if (typeof VideoDecoder === "undefined" || this.forceJpeg) {
      this.fallbackJpeg(packet.navigation, packet.revision)
      return
    }
    if (this.awaitingKey && packet.kind !== STREAM_FRAME_H264_KEY) {
      this.requestKeyframe(packet.navigation, packet.revision)
      return
    }
    const codec = STREAM_CODECS[packet.codec] ?? "avc1.640033"
    const key = `${codec}:${packet.width}x${packet.height}`
    if (!this.decoder || this.decoder.state === "closed" || this.decoderKey !== key) {
      if (packet.kind !== STREAM_FRAME_H264_KEY) {
        this.awaitingKey = true
        this.requestKeyframe(packet.navigation, packet.revision)
        return
      }
      if (!this.openDecoder(codec, key, packet.navigation, packet.revision)) return
    }
    const decoder = this.decoder
    if (!decoder || decoder.state !== "configured") return
    if (decoder.decodeQueueSize > 12 && packet.kind !== STREAM_FRAME_H264_KEY) {
      this.awaitingKey = true
      this.requestKeyframe(packet.navigation, packet.revision)
      return
    }
    this.awaitingKey = false
    this.keyRequestedAt = 0
    const ts = ++this.tsCounter
    this.metaByTs.set(ts, {
      width: packet.width,
      height: packet.height,
      navigation: packet.navigation,
      revision: packet.revision,
      sequence: packet.sequence,
    })
    try {
      decoder.decode(
        new EncodedVideoChunk({
          type: packet.kind === STREAM_FRAME_H264_KEY ? "key" : "delta",
          timestamp: ts,
          data: packet.data,
        }),
      )
    } catch {
      this.metaByTs.delete(ts)
      this.fallbackJpeg(packet.navigation, packet.revision)
    }
  }

  private openDecoder(codec: string, key: string, navigation: number, revision: number): boolean {
    this.closeDecoder()
    this.metaByTs.clear()
    const gen = this.decodeGen
    try {
      const decoder = new VideoDecoder({
        output: (frame) => this.presentVideo(frame, gen),
        error: () => {
          if (gen === this.decodeGen) this.fallbackJpeg(navigation, revision)
        },
      })
      decoder.configure({
        codec,
        hardwareAcceleration: "prefer-hardware",
        optimizeForLatency: true,
      })
      this.decoder = decoder
      this.decoderKey = key
      return true
    } catch {
      this.fallbackJpeg(navigation, revision)
      return false
    }
  }

  private presentVideo(frame: VideoFrame, gen: number): void {
    try {
      const meta = this.metaByTs.get(frame.timestamp)
      this.metaByTs.delete(frame.timestamp)
      if (this.disposed || gen !== this.decodeGen || !meta || !this.isAccepted(meta)) return
      this.onFrame(frame, meta)
    } finally {
      frame.close()
    }
  }

  private handleJpeg(packet: StreamPacket): void {
    if (this.jpegDecoding) {
      this.pendingJpeg = packet
      return
    }
    this.jpegDecoding = true
    const gen = this.decodeGen
    const copy = new Uint8Array(packet.data.byteLength)
    copy.set(packet.data)
    void createImageBitmap(new Blob([copy], { type: "image/jpeg" }))
      .then((bitmap) => {
        try {
          if (this.disposed || gen !== this.decodeGen || !this.isAccepted(packet)) return
          this.onFrame(bitmap, packet)
        } finally {
          bitmap.close()
        }
      })
      .catch(() => {})
      .finally(() => {
        this.jpegDecoding = false
        if (this.disposed) return
        const next = this.pendingJpeg
        this.pendingJpeg = undefined
        if (next && gen === this.decodeGen) this.handleJpeg(next)
      })
  }
}
