import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, truncate, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { prepareRunInput } from "../src/run-input"

const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16, 7)])

async function tempFiles() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-run-input-test-"))
  await writeFile(path.join(directory, "notes.txt"), "attached notes")
  await writeFile(path.join(directory, "guide.md"), "# Guide\n\nbody text")
  await writeFile(path.join(directory, "pixel.png"), PNG_BYTES)
  await writeFile(path.join(directory, "blob.bin"), Buffer.from([0, 1, 2, 0, 255, 0]))
  await mkdir(path.join(directory, "nested"))
  return {
    directory,
    [Symbol.asyncDispose]: () => rm(directory, { recursive: true, force: true }),
  }
}

function streamOf(chunks: string[]) {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

function decodeDataUri(uri: string) {
  return Buffer.from(uri.slice(uri.indexOf(",") + 1), "base64")
}

async function failure(pending: Promise<unknown>) {
  const error: unknown = await pending.catch((error: unknown) => error)
  if (!(error instanceof Error)) throw new Error("Expected the operation to reject with an Error")
  return error
}

test("merges positional text and piped stdin with a newline", async () => {
  await using files = await tempFiles()
  const result = await prepareRunInput(
    { text: "positional", files: [], directory: files.directory },
    streamOf(["piped ", "input"]),
  )
  expect(result.text).toBe("positional\npiped input")
  expect(result.files).toEqual([])
})

test("uses piped stdin when positional text is blank", async () => {
  await using files = await tempFiles()
  const result = await prepareRunInput({ text: "  ", files: [], directory: files.directory }, streamOf(["piped input"]))
  expect(result.text).toBe("piped input")
})

test("requires non-whitespace final text", async () => {
  await using files = await tempFiles()
  const piped = await failure(
    prepareRunInput({ text: "  ", files: [], directory: files.directory }, streamOf(["  \n\t"])),
  )
  expect(piped.message).toBe("You must provide a message")
  const empty = await failure(prepareRunInput({ text: "", files: [], directory: files.directory }))
  expect(empty.message).toBe("You must provide a message")
})

test("attaches image files with inferred mime, basename, and exact bytes", async () => {
  await using files = await tempFiles()
  const result = await prepareRunInput({
    text: "hi",
    files: [path.join(files.directory, "pixel.png")],
    directory: files.directory,
  })
  expect(result.files).toHaveLength(1)
  expect(result.files[0].name).toBe("pixel.png")
  expect(result.files[0].uri.startsWith("data:image/png;base64,")).toBe(true)
  expect(decodeDataUri(result.files[0].uri).equals(PNG_BYTES)).toBe(true)
})

test("normalizes utf-8 source files to text/plain and resolves relative paths", async () => {
  await using files = await tempFiles()
  const result = await prepareRunInput({
    text: "hi",
    files: ["guide.md", "notes.txt"],
    directory: files.directory,
  })
  expect(result.files.map((file) => file.uri.slice(0, file.uri.indexOf(",")))).toEqual([
    "data:text/plain;base64",
    "data:text/plain;base64",
  ])
  expect(result.files.map((file) => file.name)).toEqual(["guide.md", "notes.txt"])
  expect(decodeDataUri(result.files[0].uri).toString("utf8")).toBe("# Guide\n\nbody text")
})

test("keeps the detected mime for binary non-image files", async () => {
  await using files = await tempFiles()
  const result = await prepareRunInput({ text: "hi", files: ["blob.bin"], directory: files.directory })
  expect(result.files[0].uri.startsWith("data:application/octet-stream;base64,")).toBe(true)
})

test("rejects missing attachment paths", async () => {
  await using files = await tempFiles()
  const error = await failure(prepareRunInput({ text: "hi", files: ["missing.txt"], directory: files.directory }))
  expect(error.message).toBe("File not found: missing.txt")
})

test("rejects directory attachments", async () => {
  await using files = await tempFiles()
  const error = await failure(prepareRunInput({ text: "hi", files: ["nested"], directory: files.directory }))
  expect(error.message).toBe("Cannot attach a directory, special file, or file larger than 10 MiB: nested")
})

test("rejects attachments larger than 10 MiB", async () => {
  await using files = await tempFiles()
  const oversized = path.join(files.directory, "big.bin")
  await writeFile(oversized, "")
  await truncate(oversized, 10 * 1024 * 1024 + 1)
  const error = await failure(prepareRunInput({ text: "hi", files: [oversized], directory: files.directory }))
  expect(error.message).toBe(`Cannot attach a directory, special file, or file larger than 10 MiB: ${oversized}`)
})

test("rejects URL attachments", async () => {
  await using files = await tempFiles()
  const error = await failure(
    prepareRunInput({ text: "hi", files: ["https://example.com/image.png"], directory: files.directory }),
  )
  expect(error.message).toBe("Cannot attach a URL, only local files are supported: https://example.com/image.png")
})

test.skipIf(process.platform === "win32")("rejects FIFO attachments without hanging", async () => {
  await using files = await tempFiles()
  const fifo = path.join(files.directory, "pipe")
  expect(await Bun.spawn(["mkfifo", fifo]).exited).toBe(0)
  const error = await failure(prepareRunInput({ text: "hi", files: [fifo], directory: files.directory }))
  expect(error.message).toBe(`Cannot attach a directory, special file, or file larger than 10 MiB: ${fifo}`)
})

test("aborts while waiting for stdin and cancels the reader", async () => {
  await using files = await tempFiles()
  const controller = new AbortController()
  let cancelled = false
  const stream = new ReadableStream<Uint8Array>({
    start(streamController) {
      streamController.enqueue(new TextEncoder().encode("partial"))
    },
    cancel() {
      cancelled = true
    },
  })
  const pending = prepareRunInput({ text: "hi", files: [], directory: files.directory }, stream, controller.signal)
  controller.abort(new Error("stopped"))
  const error = await failure(pending)
  expect(error.message).toBe("stopped")
  expect(cancelled).toBe(true)
})

test("rejects immediately when the signal is already aborted", async () => {
  await using files = await tempFiles()
  const controller = new AbortController()
  controller.abort(new Error("stopped"))
  const error = await failure(
    prepareRunInput({ text: "hi", files: [], directory: files.directory }, streamOf(["never read"]), controller.signal),
  )
  expect(error.message).toBe("stopped")
})

test("rejects aborted signals before reading attachments", async () => {
  await using files = await tempFiles()
  const controller = new AbortController()
  controller.abort(new Error("stopped"))
  const error = await failure(
    prepareRunInput({ text: "hi", files: ["notes.txt"], directory: files.directory }, undefined, controller.signal),
  )
  expect(error.message).toBe("stopped")
})
