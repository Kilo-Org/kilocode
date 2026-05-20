/**
 * binary-frame.ts — Length-prefixed binary framing over streams
 * Ported from superset pty-daemon protocol (MIT)
 * Deps: none (Buffer is available in Bun/Node)
 *
 * Wire: [u32 BE totalLen] [u32 BE jsonLen] [json UTF-8] [payload bytes]
 */

const HDR = 4
const JLEN = 4
const MAX = 8 * 1024 * 1024

export interface Frame {
  message: unknown
  payload: Uint8Array | null
}

export function encodeFrame(message: unknown, payload?: Uint8Array): Buffer {
  const json = Buffer.from(JSON.stringify(message), "utf8")
  const pLen = payload?.byteLength ?? 0
  const total = JLEN + json.byteLength + pLen
  const out = Buffer.alloc(HDR + total)
  out.writeUInt32BE(total, 0)
  out.writeUInt32BE(json.byteLength, HDR)
  json.copy(out, HDR + JLEN)
  if (payload && payload.byteLength > 0) out.set(payload, HDR + JLEN + json.byteLength)
  return out
}

export class FrameDecoder {
  private buf = Buffer.alloc(0)

  push(chunk: Buffer): void {
    this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk])
  }

  drain(): Frame[] {
    const out: Frame[] = []
    while (this.buf.length >= HDR) {
      const total = this.buf.readUInt32BE(0)
      if (total > MAX) throw new Error(`frame too large: ${total}`)
      if (total < JLEN) throw new Error(`frame too small: ${total}`)
      if (this.buf.length < HDR + total) break
      const jLen = this.buf.readUInt32BE(HDR)
      if (jLen > total - JLEN) throw new Error(`jsonLen ${jLen} exceeds body`)
      const jStart = HDR + JLEN
      const pStart = jStart + jLen
      const end = HDR + total
      const message = JSON.parse(this.buf.subarray(jStart, pStart).toString("utf8"))
      let payload: Uint8Array | null = null
      if (pStart < end) {
        const view = this.buf.subarray(pStart, end)
        payload = new Uint8Array(view.length)
        payload.set(view, 0)
      }
      out.push({ message, payload })
      this.buf = this.buf.subarray(end)
    }
    return out
  }
}

export function decodeFrame(buf: Buffer): Frame {
  if (buf.length < HDR + JLEN) throw new Error("short frame")
  const total = buf.readUInt32BE(0)
  if (buf.length !== HDR + total) throw new Error("frame length mismatch")
  const jLen = buf.readUInt32BE(HDR)
  if (jLen > total - JLEN) throw new Error(`jsonLen ${jLen} exceeds body`)
  const jStart = HDR + JLEN
  const pStart = jStart + jLen
  const message = JSON.parse(buf.subarray(jStart, pStart).toString("utf8"))
  let payload: Uint8Array | null = null
  if (pStart < buf.length) {
    const view = buf.subarray(pStart)
    payload = new Uint8Array(view.length)
    payload.set(view, 0)
  }
  return { message, payload }
}
