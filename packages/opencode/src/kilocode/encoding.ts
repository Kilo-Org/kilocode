import { readFile, writeFile, mkdir } from "fs/promises"
import { readFileSync } from "fs"
import { dirname } from "path"
import jschardet from "jschardet"
import iconv from "iconv-lite"

/**
 * Text encoding detection and preservation for tool file I/O.
 *
 * Supported:
 *  - UTF-8 (with or without BOM)
 *  - UTF-16 LE/BE with BOM (detected by jschardet)
 *  - Legacy Latin and CJK encodings (detected by jschardet)
 *
 * Not supported:
 *  - UTF-16 without BOM (ambiguous, rare)
 *  - UTF-32 (extremely rare)
 *
 * Detection strategy:
 *  1. If the bytes are valid UTF-8, treat as UTF-8 (tracking the presence of a
 *     BOM so it can be written back).
 *  2. Otherwise, trust jschardet.
 *
 * iconv-lite's UTF codecs strip BOMs on decode and do not emit them on encode,
 * so UTF BOMs are handled explicitly in {@link encode} to round-trip cleanly.
 */
export namespace Encoding {
  export const DEFAULT = "utf-8"
  /**
   * Synthetic label for UTF-8 files that start with a BOM. iconv-lite's utf-8
   * codec always strips BOMs on decode and never emits one on encode, so we
   * track the "with BOM" case explicitly to round-trip it faithfully.
   */
  export const UTF8_BOM = "utf-8-bom"
  const UTF8_BOM_BYTES = Buffer.from([0xef, 0xbb, 0xbf])

  function hasUtf8Bom(bytes: Buffer): boolean {
    return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  }

  /** True if `bytes[0..limit]` starts with a UTF-16 LE or BE byte-order mark. */
  export function hasUtf16Bom(bytes: Buffer, limit = bytes.length): boolean {
    if (limit < 2) return false
    return (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)
  }

  /** Remap jschardet labels to iconv-lite compatible names. */
  function normalize(name: string): string {
    const lower = name.toLowerCase().replace(/[^a-z0-9]/g, "")
    const map: Record<string, string> = {
      utf8: "utf-8",
      utf16le: "utf-16le",
      utf16be: "utf-16be",
      ascii: "utf-8",
      iso88591: "iso-8859-1",
      iso88592: "iso-8859-2",
      iso88595: "iso-8859-5",
      iso88597: "iso-8859-7",
      iso88598: "iso-8859-8",
      iso88599: "iso-8859-9",
      windows1250: "windows-1250",
      windows1251: "windows-1251",
      windows1252: "windows-1252",
      windows1253: "windows-1253",
      windows1255: "windows-1255",
      shiftjis: "Shift_JIS",
      eucjp: "euc-jp",
      iso2022jp: "iso-2022-jp",
      euckr: "euc-kr",
      iso2022kr: "iso-2022-kr",
      big5: "big5",
      gb2312: "gb2312",
      gb18030: "gb18030",
      koi8r: "koi8-r",
      maccyrillic: "x-mac-cyrillic",
      ibm855: "cp855",
      ibm866: "cp866",
      tis620: "tis-620",
    }
    return map[lower] ?? name
  }

  function isUtf8(bytes: Buffer): boolean {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes)
      return true
    } catch {
      return false
    }
  }

  export function detect(bytes: Buffer): string {
    if (bytes.length === 0) return DEFAULT
    if (isUtf8(bytes)) return hasUtf8Bom(bytes) ? UTF8_BOM : DEFAULT
    const result = jschardet.detect(bytes)
    if (!result.encoding) return DEFAULT
    const enc = normalize(result.encoding)
    // Reject unsupported Unicode encodings (UTF-32 and anything iconv-lite cannot decode)
    if (enc.toLowerCase().startsWith("utf-32")) return DEFAULT
    if (!iconv.encodingExists(enc)) return DEFAULT
    return enc
  }

  export function decode(bytes: Buffer, encoding: string): string {
    if (encoding === UTF8_BOM) return iconv.decode(bytes, "utf-8")
    return iconv.decode(bytes, encoding)
  }

  export function encode(text: string, encoding: string): Buffer {
    // iconv-lite's UTF codecs strip/ignore BOMs, but we support "UTF-X with BOM"
    // as a distinct variant. Prepend the BOM manually so round-tripping keeps
    // the original byte signature intact. Strip a leading U+FEFF from `text`
    // first so we never emit a double BOM when the decoded text already
    // contains one (e.g. if a tool round-trips content verbatim).
    const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
    if (encoding === UTF8_BOM) return Buffer.concat([UTF8_BOM_BYTES, iconv.encode(body, "utf-8")])
    const lower = encoding.toLowerCase()
    if (lower === "utf-16le") return Buffer.concat([Buffer.from([0xff, 0xfe]), iconv.encode(body, encoding)])
    if (lower === "utf-16be") return Buffer.concat([Buffer.from([0xfe, 0xff]), iconv.encode(body, encoding)])
    return iconv.encode(text, encoding)
  }

  /** Read a file, detecting its encoding. */
  export async function read(path: string): Promise<{ text: string; encoding: string }> {
    const bytes = await readFile(path)
    const encoding = detect(bytes)
    return { text: decode(bytes, encoding), encoding }
  }

  /** Synchronous read, detecting encoding. */
  export function readSync(path: string): { text: string; encoding: string } {
    const bytes = readFileSync(path)
    const encoding = detect(bytes)
    return { text: decode(bytes, encoding), encoding }
  }

  /** Write text, ensuring parent directory exists, using the given encoding. */
  export async function write(path: string, text: string, encoding: string = DEFAULT): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, encode(text, encoding))
  }
}
