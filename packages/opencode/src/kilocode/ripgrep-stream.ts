import { StringDecoder } from "string_decoder"

export namespace RipgrepStream {
  export function decoder() {
    return new StringDecoder("utf8")
  }

  function decode(dec: StringDecoder, input: unknown) {
    if (typeof input === "string") return input
    if (input instanceof ArrayBuffer) return dec.write(Buffer.from(input))
    if (ArrayBuffer.isView(input)) return dec.write(Buffer.from(input.buffer, input.byteOffset, input.byteLength))
    return String(input)
  }

  export function drain(dec: StringDecoder, buf: string, chunk: unknown, push: (line: string) => void) {
    const lines = (buf + decode(dec, chunk)).split(/\r?\n/)
    const rest = lines.pop() || ""
    for (const line of lines) {
      if (line) push(line)
    }
    return rest
  }
}
