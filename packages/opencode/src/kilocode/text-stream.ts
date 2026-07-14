import type { FSUtil } from "@opencode-ai/core/fs-util"
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

type FileSystem = Pick<FSUtil.Interface, "readFile" | "stream">

function decode(decoder: TextDecoder, bytes?: Uint8Array) {
  try {
    return decoder.decode(bytes, bytes ? { stream: true } : undefined)
  } catch {
    throw new InvalidUtf8Error()
  }
}

function utf8(fs: FileSystem, filepath: string, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const iterator = Stream.toAsyncIterable(fs.stream(filepath))[Symbol.asyncIterator]()
  const decoder = new TextDecoder("utf-8", { fatal: true })
  const out = new Readable({
    read() {
      void (async () => {
        while (true) {
          const next = await iterator.next()
          if (next.done) {
            const tail = decode(decoder)
            if (tail) this.push(tail)
            this.push(null)
            return
          }
          const text = decode(decoder, next.value)
          if (!text) continue
          this.push(text)
          return
        }
      })().catch((err) => this.destroy(err instanceof Error ? err : new Error(String(err))))
    },
    destroy(err, callback) {
      Promise.resolve(iterator.return?.()).then(
        () => callback(err),
        (cause) => callback(cause instanceof Error ? cause : new Error(String(cause))),
      )
    },
  })
  const closed = new Promise<void>((resolve) => out.once("close", resolve))

  return { stream: abortable(out, signal), closed }
}

export function abortable(stream: Readable, signal?: AbortSignal) {
  return signal ? addAbortSignal(signal, stream) : stream
}

/** UTF-8 text stream backed by the injected filesystem service. */
export function openUtf8(fs: FileSystem, filepath: string, signal?: AbortSignal): Readable {
  return utf8(fs, filepath, signal).stream
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
  const input = utf8(fs, filepath, signal)
  try {
    return await fn(input.stream)
  } catch (err) {
    if (!(err instanceof InvalidUtf8Error)) throw err
  } finally {
    input.stream.destroy()
    await input.closed
  }
  return fn(await openDecoded(fs, filepath, signal))
}
