import { ripgrep } from "ripgrep"
import { RipgrepStream } from "../kilocode/ripgrep-stream" // kilocode_change - share UTF-8 stream decoding

function env() {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((item): item is [string, string] => item[1] !== undefined),
  )
  delete env.RIPGREP_CONFIG_PATH
  return env
}

function opts(cwd: string) {
  return {
    env: env(),
    preopens: { ".": cwd },
  }
}

type Run = {
  kind: "files" | "search"
  cwd: string
  args: string[]
}

function text(input: unknown) {
  if (typeof input === "string") return input
  if (input instanceof ArrayBuffer) return Buffer.from(input).toString()
  if (ArrayBuffer.isView(input)) return Buffer.from(input.buffer, input.byteOffset, input.byteLength).toString()
  return String(input)
}

function error(input: unknown) {
  if (input instanceof Error) {
    return {
      message: input.message,
      name: input.name,
      stack: input.stack,
    }
  }

  return {
    message: String(input),
  }
}

function clean(file: string) {
  return file.replace(/^\.[\\/]/, "")
}

onmessage = async (evt: MessageEvent<Run>) => {
  const msg = evt.data

  try {
    if (msg.kind === "search") {
      const ret = await ripgrep(msg.args, {
        buffer: true,
        ...opts(msg.cwd),
      })
      postMessage({
        type: "result",
        code: ret.code ?? 0,
        stdout: ret.stdout ?? "",
        stderr: ret.stderr ?? "",
      })
      return
    }

    let buf = ""
    let err = ""
    // kilocode_change start - keep decoder state across stdout chunks
    const decoder = RipgrepStream.decoder()
    const out = {
      write(chunk: unknown) {
        buf = RipgrepStream.drain(decoder, buf, chunk, (line) => postMessage({ type: "line", line: clean(line) }))
      },
    }
    // kilocode_change end
    const stderr = {
      write(chunk: unknown) {
        err += text(chunk)
      },
    }

    const ret = await ripgrep(msg.args, {
      stdout: out,
      stderr,
      ...opts(msg.cwd),
    })

    buf += decoder.end() // kilocode_change - flush any trailing buffered bytes
    if (buf) postMessage({ type: "line", line: clean(buf) })
    postMessage({
      type: "done",
      code: ret.code ?? 0,
      stderr: err,
    })
  } catch (err) {
    postMessage({
      type: "error",
      error: error(err),
    })
  }
}
