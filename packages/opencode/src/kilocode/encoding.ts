// kilocode_change - new file
import { readFileSync } from "fs"
import { readFile, writeFile, mkdir } from "fs/promises"
import { dirname } from "path"
import { existsSync } from "fs"

/**
 * Text encoding detection and preservation.
 * Detects file encoding from raw bytes (BOM + heuristics) and provides
 * round-trip read/write that preserves the original encoding.
 */
export namespace Encoding {
  export interface Info {
    encoding: "utf-8" | "utf-16le" | "utf-16be" | "latin1"
    bom: boolean
  }

  const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf])
  const UTF16_LE_BOM = Buffer.from([0xff, 0xfe])
  const UTF16_BE_BOM = Buffer.from([0xfe, 0xff])

  export const DEFAULT: Info = { encoding: "utf-8", bom: false }

  export function detect(bytes: Buffer): Info {
    // BOM detection (most reliable signal)
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      return { encoding: "utf-8", bom: true }
    }
    // Check UTF-16 BE before LE because FF FE could also be the start of UTF-32 LE,
    // but FE FF is unambiguously UTF-16 BE.
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      return { encoding: "utf-16be", bom: true }
    }
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
      return { encoding: "utf-16le", bom: true }
    }

    // Heuristic: detect BOM-less UTF-16 by looking for null-byte patterns
    if (bytes.length >= 4) {
      let le = 0
      let be = 0
      const sample = Math.min(bytes.length & ~1, 512) // even number of bytes
      for (let i = 0; i < sample; i += 2) {
        if (bytes[i] !== 0 && bytes[i + 1] === 0) le++
        if (bytes[i] === 0 && bytes[i + 1] !== 0) be++
      }
      const pairs = sample / 2
      if (le > pairs / 4) return { encoding: "utf-16le", bom: false }
      if (be > pairs / 4) return { encoding: "utf-16be", bom: false }
    }

    // Check if valid UTF-8; if not, fall back to Latin-1
    if (!isUtf8(bytes)) {
      return { encoding: "latin1", bom: false }
    }

    return DEFAULT
  }

  export function decode(bytes: Buffer, info: Info): string {
    const start = info.bom ? (info.encoding === "utf-8" ? 3 : 2) : 0
    const data = start > 0 ? bytes.subarray(start) : bytes

    switch (info.encoding) {
      case "utf-8":
        return data.toString("utf-8")
      case "utf-16le":
        return data.toString("utf16le")
      case "utf-16be": {
        const swapped = Buffer.allocUnsafe(data.length)
        for (let i = 0; i < data.length - 1; i += 2) {
          swapped[i] = data[i + 1]
          swapped[i + 1] = data[i]
        }
        return swapped.toString("utf16le")
      }
      case "latin1":
        return data.toString("latin1")
    }
  }

  export function encode(text: string, info: Info): Buffer {
    let body: Buffer
    switch (info.encoding) {
      case "utf-8":
        body = Buffer.from(text, "utf-8")
        break
      case "utf-16le":
        body = Buffer.from(text, "utf16le")
        break
      case "utf-16be": {
        const le = Buffer.from(text, "utf16le")
        body = Buffer.allocUnsafe(le.length)
        for (let i = 0; i < le.length - 1; i += 2) {
          body[i] = le[i + 1]
          body[i + 1] = le[i]
        }
        break
      }
      case "latin1":
        body = Buffer.from(text, "latin1")
        break
    }

    if (!info.bom) return body

    const bom =
      info.encoding === "utf-8"
        ? UTF8_BOM
        : info.encoding === "utf-16le"
          ? UTF16_LE_BOM
          : info.encoding === "utf-16be"
            ? UTF16_BE_BOM
            : Buffer.alloc(0)

    return Buffer.concat([bom, body])
  }

  /** Read a file preserving its encoding info. */
  export async function read(path: string): Promise<{ text: string; info: Info }> {
    const bytes = await readFile(path)
    const info = detect(bytes)
    return { text: decode(bytes, info), info }
  }

  /** Read a file synchronously, preserving its encoding info. */
  export function readSync(path: string): { text: string; info: Info } {
    const bytes = readFileSync(path)
    const info = detect(bytes)
    return { text: decode(bytes, info), info }
  }

  /** Write text back to a file using the given encoding info. */
  export async function write(path: string, text: string, info: Info): Promise<void> {
    const bytes = encode(text, info)
    const dir = dirname(path)
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
    }
    await writeFile(path, bytes)
  }

  function isUtf8(bytes: Buffer): boolean {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes)
      return true
    } catch {
      return false
    }
  }
}
