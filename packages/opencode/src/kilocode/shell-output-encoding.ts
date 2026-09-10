/**
 * Agent shell captures stdout through a pipe and historically decoded it as
 * UTF-8. On Chinese Windows, Python writes GBK/cp936 unless PYTHONIOENCODING
 * is set, so CJK becomes U+FFFD diamonds. This helper injects that env
 * (without overriding a user value) and decodes leftover locale bytes as
 * GB18030 when they are not valid UTF-8.
 *
 * Bytes stay tentative UTF-8 until a definite invalid sequence appears, then
 * GB18030 is locked so a later window cut cannot flip the whole stream.
 * Do not set PYTHONUTF8 — that also changes open() defaults.
 */

import * as Encoding from "./encoding"

const PYTHON_IO_ENCODING = "PYTHONIOENCODING"

export function hasEnv(env: NodeJS.ProcessEnv, key: string): boolean {
  if (env[key] !== undefined) return true
  if (process.platform !== "win32") return false
  const found = Object.keys(env).find((item) => item.toLowerCase() === key.toLowerCase())
  return found !== undefined && env[found] !== undefined
}

/** Add PYTHONIOENCODING=utf-8 when neither the overlay nor process.env already set it. */
export function withUtf8StdioEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (hasEnv(env, PYTHON_IO_ENCODING) || hasEnv(process.env, PYTHON_IO_ENCODING)) return env
  return { ...env, [PYTHON_IO_ENCODING]: "utf-8" }
}

function isValidUtf8(bytes: Buffer): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    return true
  } catch {
    return false
  }
}

function isUtf8SequenceStart(bytes: Buffer): boolean {
  if (bytes.length === 0) return true
  const b = bytes[0]
  if (b < 0x80) return true
  if (b >= 0xc2 && b <= 0xdf) return bytes.length < 2
  if (b >= 0xe0 && b <= 0xef) return bytes.length < 3
  if (b >= 0xf0 && b <= 0xf4) return bytes.length < 4
  return false
}

/** Longest valid UTF-8 prefix. -1 means a definite invalid sequence. */
function utf8CompletePrefix(bytes: Buffer): number {
  if (isValidUtf8(bytes)) return bytes.length
  for (let n = 1; n <= 3 && n <= bytes.length; n++) {
    const head = bytes.subarray(0, bytes.length - n)
    const tail = bytes.subarray(bytes.length - n)
    if (isValidUtf8(head) && isUtf8SequenceStart(tail)) return head.length
  }
  return -1
}

function takeCompleteGbk(bytes: Buffer): { complete: Buffer; leftover: Buffer } {
  let i = 0
  while (i < bytes.length) {
    const lead = bytes[i]
    if (lead < 0x80) {
      i += 1
      continue
    }
    if (lead < 0x81 || lead > 0xfe) {
      i += 1
      continue
    }
    if (i + 1 >= bytes.length) break
    const trail = bytes[i + 1]
    if (trail >= 0x30 && trail <= 0x39) {
      if (i + 3 >= bytes.length) break
      i += 4
      continue
    }
    i += 2
  }
  return { complete: bytes.subarray(0, i), leftover: bytes.subarray(i) }
}

export class ShellOutputDecoder {
  private leftover = Buffer.alloc(0)
  private encoding: "gb18030" | undefined
  private readonly utf8 = new TextDecoder("utf-8")

  push(chunk: Uint8Array): string {
    const buf = Buffer.concat([this.leftover, Buffer.from(chunk)])
    this.leftover = Buffer.alloc(0)
    if (buf.length === 0) return ""
    if (this.encoding === "gb18030") return this.decodeGbk(buf)

    const prefix = utf8CompletePrefix(buf)
    if (prefix === buf.length) return this.utf8.decode(buf, { stream: true })
    if (prefix >= 0) {
      this.leftover = buf.subarray(prefix)
      return prefix === 0 ? "" : this.utf8.decode(buf.subarray(0, prefix), { stream: true })
    }
    this.encoding = "gb18030"
    return this.decodeGbk(buf)
  }

  flush(): string {
    if (this.leftover.length === 0) {
      return this.encoding === "gb18030" ? "" : this.utf8.decode()
    }
    const pending = this.leftover
    this.leftover = Buffer.alloc(0)
    if (this.encoding === "gb18030" || !isValidUtf8(pending)) {
      return Encoding.decode(pending, "gb18030")
    }
    return this.utf8.decode(pending)
  }

  private decodeGbk(buf: Buffer): string {
    const { complete, leftover } = takeCompleteGbk(buf)
    this.leftover = leftover
    return complete.length === 0 ? "" : Encoding.decode(complete, "gb18030")
  }
}

/** One-shot decode of a complete captured buffer. */
export function decodeShellOutput(bytes: Uint8Array): string {
  const decoder = new ShellOutputDecoder()
  return decoder.push(bytes) + decoder.flush()
}
