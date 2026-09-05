import type { SessionPromptInput } from "@opencode-ai/client/promise"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { constants } from "node:fs"
import { open, stat } from "node:fs/promises"
import path from "node:path"

// The public client has no FilePart named export; the prompt attachment surface is
// the element of SessionPromptInput["files"]. PromptFileAttachment is the
// post-materialization message shape, not what client.session.prompt accepts.
export type FilePart = NonNullable<SessionPromptInput["files"]>[number]

const ATTACH_FILE_MAX_BYTES = 10 * 1024 * 1024

export async function prepareRunInput(
  input: { text: string; files: readonly string[]; directory: string },
  stdin?: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): Promise<{ text: string; files: FilePart[] }> {
  throwIfAborted(signal)
  const piped = stdin ? await readStdin(stdin, signal) : undefined
  throwIfAborted(signal)
  const text = mergeText(input.text, piped)
  if (!text.trim()) throw new Error("You must provide a message")
  const files = await Promise.all(input.files.map((file) => prepareFile(file, input.directory)))
  throwIfAborted(signal)
  return { text, files }
}

function mergeText(text: string, piped: string | undefined) {
  const positional = text.trim() ? text : undefined
  if (!positional) return piped ?? ""
  if (!piped) return positional
  return `${positional}\n${piped}`
}

async function readStdin(stream: ReadableStream<Uint8Array>, signal: AbortSignal | undefined) {
  const reader = stream.getReader()
  try {
    const decoder = new TextDecoder()
    let text = ""
    while (true) {
      const next = await raceAbort(signal, () => void reader.cancel().catch(() => {}), reader.read())
      if (next.done) return text + decoder.decode()
      text += decoder.decode(next.value, { stream: true })
    }
  } finally {
    reader.releaseLock()
  }
}

function raceAbort<T>(signal: AbortSignal | undefined, cancel: () => void, promise: Promise<T>): Promise<T> {
  if (!signal) return promise
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cancel()
      reject(abortReason(signal))
    }
    if (signal.aborted) {
      onAbort()
    } else {
      signal.addEventListener("abort", onAbort, { once: true })
    }
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener("abort", onAbort)
        reject(error)
      },
    )
  })
}

function abortReason(signal: AbortSignal) {
  return signal.reason ?? new Error("Run interrupted")
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw abortReason(signal)
}

async function prepareFile(input: string, directory: string): Promise<FilePart> {
  if (isExternalPath(input)) fail(`Cannot attach a URL, only local files are supported: ${input}`)
  const file = path.resolve(directory, input)
  const info = await stat(file).catch(() => fail(`File not found: ${input}`))
  if (!info.isFile()) fail(`Cannot attach a directory, special file, or file larger than 10 MiB: ${input}`)
  // The stat above can miss a path swapped to a FIFO before the open; O_NONBLOCK
  // keeps that open from hanging instead of blocking until a writer connects.
  const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK).catch(() =>
    fail(`File not found: ${input}`),
  )
  try {
    const attached = await handle.stat()
    if (!attached.isFile() || attached.size > ATTACH_FILE_MAX_BYTES)
      fail(`Cannot attach a directory, special file, or file larger than 10 MiB: ${input}`)
    const content = Buffer.alloc(attached.size)
    let offset = 0
    while (offset < content.length) {
      const read = await handle.read(content, offset, content.length - offset, offset)
      if (read.bytesRead === 0) break
      offset += read.bytesRead
    }
    const bytes = content.subarray(0, offset)
    const detected = FSUtil.mimeType(file)
    const text = bytes.toString("utf8")
    const mime =
      detected.startsWith("image/") || detected === "application/pdf"
        ? detected
        : !isBinaryContent(bytes) && Buffer.from(text, "utf8").equals(bytes)
          ? "text/plain"
          : detected
    return { uri: `data:${mime};base64,${bytes.toString("base64")}`, name: path.basename(file) }
  } finally {
    await handle.close()
  }
}

function isExternalPath(input: string) {
  return /^[a-z][a-z0-9+.-]*:/i.test(input) && !/^[a-z]:[\\/]/i.test(input)
}

function isBinaryContent(bytes: Uint8Array) {
  if (bytes.length === 0) return false
  if (bytes.includes(0)) return true
  return bytes.reduce((count, byte) => count + Number(byte < 9 || (byte > 13 && byte < 32)), 0) / bytes.length > 0.3
}

function fail(message: string): never {
  throw new Error(message)
}
