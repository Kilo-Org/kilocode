// kilocode_change - new file
import { readFile } from "fs/promises"
import { readFileSync } from "fs"

/**
 * Represents the detected encoding metadata of a file.
 * Used to preserve original encoding when reading and writing files.
 */
export interface FileEncoding {
  /** The character encoding (e.g., "utf-8", "utf-16le", "utf-16be", "latin1") */
  encoding: BufferEncoding
  /** Whether the file starts with a BOM (Byte Order Mark) */
  bom: boolean
  /** The line ending style detected in the file */
  lineEnding: "lf" | "crlf" | "mixed"
}

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf])
const UTF16LE_BOM = Buffer.from([0xff, 0xfe])
const UTF16BE_BOM = Buffer.from([0xfe, 0xff])

/** Default encoding for new files or when detection isn't needed */
export const DEFAULT_ENCODING: FileEncoding = {
  encoding: "utf-8",
  bom: false,
  lineEnding: "lf",
}

/**
 * Detect the BOM and encoding from raw file bytes.
 * Returns the encoding and the byte offset where actual content starts.
 */
function detectBOM(bytes: Buffer): { encoding: BufferEncoding; bom: boolean; offset: number } {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { encoding: "utf-8", bom: true, offset: 3 }
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { encoding: "utf16le", bom: true, offset: 2 }
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    // Node.js doesn't have a "utf16be" BufferEncoding natively,
    // but we detect it and handle it via manual byte-swapping
    return { encoding: "utf16le", bom: true, offset: 2 }
  }
  return { encoding: "utf-8", bom: false, offset: 0 }
}

/**
 * Detect the dominant line ending style in text content.
 */
function detectLineEnding(text: string): "lf" | "crlf" | "mixed" {
  let crlf = 0
  let lf = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\r" && i + 1 < text.length && text[i + 1] === "\n") {
      crlf++
      i++ // skip the \n
    } else if (text[i] === "\n") {
      lf++
    }
  }
  if (crlf === 0 && lf === 0) return "lf"
  if (crlf > 0 && lf === 0) return "crlf"
  if (crlf === 0 && lf > 0) return "lf"
  return "mixed"
}

/**
 * Check if the raw bytes look like UTF-16BE (BOM-based detection above handles this,
 * but we also detect BOM-less UTF-16BE by checking for alternating null bytes).
 */
function isUtf16BE(bytes: Buffer): boolean {
  if (bytes.length < 4) return false
  // Check for pattern: 0x00 XX 0x00 XX (typical ASCII range in UTF-16BE)
  return bytes[0] === 0 && bytes[1] !== 0 && bytes[2] === 0 && bytes[3] !== 0
}

/**
 * Swap byte pairs for UTF-16BE → UTF-16LE conversion.
 */
function swapBytes(buf: Buffer): Buffer {
  const swapped = Buffer.alloc(buf.length)
  for (let i = 0; i + 1 < buf.length; i += 2) {
    swapped[i] = buf[i + 1]
    swapped[i + 1] = buf[i]
  }
  return swapped
}

/**
 * Detect the encoding of a file and return its text content along with encoding metadata.
 * This reads the file as raw bytes, detects BOM/encoding, and decodes accordingly.
 */
export async function readWithEncoding(filepath: string): Promise<{ text: string; fileEncoding: FileEncoding }> {
  const bytes = await readFile(filepath)
  return decodeWithEncoding(bytes)
}

/**
 * Synchronous version of readWithEncoding.
 */
export function readWithEncodingSync(filepath: string): { text: string; fileEncoding: FileEncoding } {
  const bytes = readFileSync(filepath)
  return decodeWithEncoding(bytes)
}

/**
 * Decode raw bytes into text with encoding detection.
 */
function decodeWithEncoding(bytes: Buffer): { text: string; fileEncoding: FileEncoding } {
  if (bytes.length === 0) {
    return { text: "", fileEncoding: { ...DEFAULT_ENCODING } }
  }

  const bom = detectBOM(bytes)

  // Handle UTF-16BE (with BOM: FE FF)
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const content = bytes.subarray(2)
    const swapped = swapBytes(content)
    const text = swapped.toString("utf16le")
    return {
      text,
      fileEncoding: {
        encoding: "utf16le", // We'll store as utf16le but track BOM to know it was BE
        bom: true,
        lineEnding: detectLineEnding(text),
      },
    }
  }

  // Handle UTF-16LE with BOM
  if (bom.bom && bom.encoding === "utf16le") {
    const content = bytes.subarray(bom.offset)
    const text = content.toString("utf16le")
    return {
      text,
      fileEncoding: {
        encoding: "utf16le",
        bom: true,
        lineEnding: detectLineEnding(text),
      },
    }
  }

  // Handle BOM-less UTF-16BE detection
  if (!bom.bom && isUtf16BE(bytes)) {
    const swapped = swapBytes(bytes)
    const text = swapped.toString("utf16le")
    return {
      text,
      fileEncoding: {
        encoding: "utf16le",
        bom: false,
        lineEnding: detectLineEnding(text),
      },
    }
  }

  // UTF-8 (with or without BOM)
  const content = bytes.subarray(bom.offset)
  const text = content.toString("utf-8")
  return {
    text,
    fileEncoding: {
      encoding: "utf-8",
      bom: bom.bom,
      lineEnding: detectLineEnding(text),
    },
  }
}

/**
 * Encode text content back to bytes, preserving the original file encoding.
 * This re-applies the BOM and line ending style that were detected on read.
 */
export function encodeWithEncoding(text: string, fileEncoding: FileEncoding): Buffer {
  // Normalize line endings in the text to LF first, then convert to target
  const normalized = text.replaceAll("\r\n", "\n")
  const withLineEndings = fileEncoding.lineEnding === "crlf" ? normalized.replaceAll("\n", "\r\n") : normalized

  const encoded =
    fileEncoding.encoding === "utf16le"
      ? Buffer.from(withLineEndings, "utf16le")
      : Buffer.from(withLineEndings, "utf-8")

  if (!fileEncoding.bom) return encoded

  // Prepend the appropriate BOM
  const bomBytes = fileEncoding.encoding === "utf16le" ? UTF16LE_BOM : UTF8_BOM

  return Buffer.concat([bomBytes, encoded])
}

/**
 * Write text to a file, preserving the specified encoding.
 */
export async function writeWithEncoding(filepath: string, text: string, fileEncoding: FileEncoding): Promise<void> {
  const { writeFile } = await import("fs/promises")
  const { mkdir } = await import("fs/promises")
  const { dirname } = await import("path")

  const encoded = encodeWithEncoding(text, fileEncoding)
  try {
    await writeFile(filepath, encoded)
  } catch (e: unknown) {
    if (typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "ENOENT") {
      await mkdir(dirname(filepath), { recursive: true })
      await writeFile(filepath, encoded)
      return
    }
    throw e
  }
}
