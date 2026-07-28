import { parseDestination } from "./destination"

const MAX_RECORD = 16 * 1024
const MAX_HELLO = 64 * 1024 - 1
const MAX_INPUT = 128 * 1024
const COMPAT = Buffer.from([20, 3, 3, 0, 1, 1])

type State = "pending" | "valid" | "invalid"

function hostname(input: Buffer) {
  if (
    input.length === 0 ||
    input.some(
      (byte) =>
        !(
          (byte >= 0x30 && byte <= 0x39) ||
          (byte >= 0x41 && byte <= 0x5a) ||
          (byte >= 0x61 && byte <= 0x7a) ||
          byte === 0x2d ||
          byte === 0x2e
        ),
    )
  ) {
    return
  }
  try {
    return parseDestination(input.toString("ascii")).host
  } catch {
    return
  }
}

function validate(input: Buffer, expected: string) {
  let offset = 0
  const take = (length: number) => {
    if (offset + length > input.length) return
    const value = input.subarray(offset, offset + length)
    offset += length
    return value
  }
  const uint16 = () => {
    const value = take(2)
    return value?.readUInt16BE(0)
  }

  const version = take(2)
  if (!version || version[0] !== 3 || version[1] < 1 || version[1] > 3) return false
  if (!take(32)) return false

  const session = take(1)?.[0]
  if (session === undefined || session > 32 || !take(session)) return false

  const ciphers = uint16()
  if (ciphers === undefined || ciphers < 2 || ciphers % 2 !== 0 || !take(ciphers)) return false

  const compression = take(1)?.[0]
  const methods = compression === undefined ? undefined : take(compression)
  if (!methods || methods.length === 0 || !methods.includes(0)) return false

  const length = uint16()
  if (length === undefined || length !== input.length - offset) return false

  const seen = new Set<number>()
  let sni: string | undefined
  while (offset < input.length) {
    const type = uint16()
    const size = uint16()
    if (type === undefined || size === undefined || seen.has(type)) return false
    seen.add(type)
    const data = take(size)
    if (!data) return false

    // Encrypted ClientHello and TLS 1.3 early data cannot be safely authorized by outer SNI inspection.
    if (type === 0xfe0d || type === 0xffce || type === 42) return false
    if (type !== 0) continue

    if (data.length < 5 || data.readUInt16BE(0) !== data.length - 2) return false
    let index = 2
    let count = 0
    while (index < data.length) {
      if (index + 3 > data.length) return false
      const kind = data[index]
      const size = data.readUInt16BE(index + 1)
      index += 3
      if (kind !== 0 || size === 0 || index + size > data.length) return false
      const host = hostname(data.subarray(index, index + size))
      if (!host) return false
      sni = host
      count++
      index += size
    }
    if (index !== data.length || count !== 1) return false
  }
  return offset === input.length && sni === expected
}

export class TlsClientHello {
  private readonly header = Buffer.alloc(5)
  private readonly handshake = Buffer.alloc(4)
  private readonly chunks: Buffer[] = []
  private hpos = 0
  private mpos = 0
  private remaining = 0
  private body: Buffer | undefined
  private bpos = 0
  private cpos = 0
  private total = 0
  private state: State = "pending"
  private validated = false

  constructor(private readonly expected: string) {}

  push(input: Buffer): State {
    if (this.state === "invalid" || input.length === 0) return this.state
    if (this.total + input.length > MAX_INPUT) return this.reject()
    this.chunks.push(Buffer.from(input))
    this.total += input.length

    for (let index = 0; index < input.length; index++) {
      const byte = input[index]
      if (this.validated) {
        if (this.cpos >= COMPAT.length || byte !== COMPAT[this.cpos]) return this.reject()
        this.cpos++
        this.state = this.cpos === COMPAT.length ? "valid" : "pending"
        continue
      }
      if (this.remaining === 0) {
        this.header[this.hpos++] = byte
        if (this.hpos < this.header.length) continue
        if (this.header[0] !== 22 || this.header[1] !== 3 || this.header[2] < 1 || this.header[2] > 3) {
          return this.reject()
        }
        this.remaining = this.header.readUInt16BE(3)
        this.hpos = 0
        if (this.remaining === 0 || this.remaining > MAX_RECORD) return this.reject()
        continue
      }

      this.remaining--
      if (!this.body) {
        this.handshake[this.mpos++] = byte
        if (this.mpos === this.handshake.length) {
          if (this.handshake[0] !== 1) return this.reject()
          const size = this.handshake.readUIntBE(1, 3)
          if (size === 0 || size > MAX_HELLO) return this.reject()
          this.body = Buffer.alloc(size)
        }
      } else {
        this.body[this.bpos++] = byte
      }

      if (this.body && this.bpos === this.body.length) {
        if (this.remaining !== 0 || !validate(this.body, this.expected)) {
          return this.reject()
        }
        this.validated = true
        this.state = "valid"
      }
    }
    return this.state
  }

  bytes() {
    if (this.state !== "valid") throw new Error("TLS ClientHello is not valid")
    return Buffer.concat(this.chunks, this.total)
  }

  private reject(): State {
    this.state = "invalid"
    return this.state
  }
}
