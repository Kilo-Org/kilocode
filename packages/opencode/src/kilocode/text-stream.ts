import type { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Effect, Stream } from "effect"
import { addAbortSignal, Readable } from "stream"
import * as Encoding from "./encoding"

/**
 * Encoding-aware text streaming for tools that walk a file line by line.
 * Optimistically stream as UTF-8; fall back to a buffered iconv decode only
 * when the bytes turn out not to be valid UTF-8.
 *
 *   import * as TextStream from "../kilocode/text-stream"
 */

/** Distinct class so {@link withFallback} can tell us apart from real I/O failures. */
export class InvalidUtf8Error extends Error {
  constructor() {
    super("invalid utf-8")
  }
}

type FileSystem = Pick<AppFileSystem.Interface, "readFile" | "stream">

function decode(decoder: TextDecoder, bytes?: Uint8Array) {
  try {
    return decoder.decode(bytes, bytes ? { stream: true } : undefined)
  } catch {
    throw new InvalidUtf8Error()
  }
}

async function* chunks(fs: FileSystem, filepath: string) {
  const decoder = new TextDecoder("utf-8", { fatal: true })
  for await (const bytes of Stream.toAsyncIterable(fs.stream(filepath))) {
    const text = decode(decoder, bytes)
    if (text) yield text
  }
  const tail = decode(decoder)
  if (tail) yield tail
}

export function abortable(stream: Readable, signal?: AbortSignal) {
  return signal ? addAbortSignal(signal, stream) : stream
}

/** UTF-8 text stream backed by the injected filesystem service. */
export function openUtf8(fs: FileSystem, filepath: string, signal?: AbortSignal): Readable {
  return abortable(Readable.from(chunks(fs, filepath)), signal)
}

export function safeSlice(text: string, end: number) {
  const sliced = text.slice(0, end)
  const last = sliced.charCodeAt(sliced.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? sliced.slice(0, -1) : sliced
}

/** Whole-file decoded Readable; buffers legacy encodings only after UTF-8 streaming fails. */
export async function openDecoded(fs: FileSystem, filepath: string, signal?: AbortSignal): Promise<Readable> {
  const bytes = Buffer.from(await Effect.runPromise(fs.readFile(filepath), { signal }))
  return abortable(Readable.from([Encoding.decode(bytes, Encoding.detect(bytes))]), signal)
}

/**
 * Run `fn` against an optimistic UTF-8 stream; on {@link InvalidUtf8Error}
 * retry once against {@link openDecoded}. Other errors propagate.
 */
export async function withFallback<T>(
  fs: FileSystem,
  filepath: string,
  fn: (input: Readable) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  try {
    return await fn(openUtf8(fs, filepath, signal))
  } catch (err) {
    if (!(err instanceof InvalidUtf8Error)) throw err
  }
  return fn(await openDecoded(fs, filepath, signal))
}
