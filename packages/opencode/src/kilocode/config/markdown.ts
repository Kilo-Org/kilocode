import os from "os"
import path from "path"
import { Filesystem } from "@/util/filesystem"

export namespace KilocodeMarkdown {
  function ref(token: string) {
    const file = token.replace(/^\{file:/, "").replace(/\}$/, "")
    if (file.startsWith("~/")) return path.join(os.homedir(), file.slice(2))
    return file
  }

  export async function substitute(text: string, item: string) {
    const body = text.replace(/\{env:([^}]+)\}/g, (_, name) => process.env[name] || "")
    const matches = Array.from(body.matchAll(/\{file:[^}]+\}/g))
    if (!matches.length) return body

    const dir = path.dirname(item)
    const chunks = await Promise.all(
      matches.map(async (match, i) => {
        const token = match[0]
        const index = match.index ?? 0
        const prev = matches[i - 1]
        const cursor = prev ? (prev.index ?? 0) + prev[0].length : 0
        const head = body.slice(cursor, index)
        const start = body.lastIndexOf("\n", index - 1) + 1
        const prefix = body.slice(start, index).trimStart()
        if (prefix.startsWith("//")) return head + token

        const file = ref(token)
        const target = path.isAbsolute(file) ? file : path.resolve(dir, file)
        const content = await Filesystem.readText(target).catch(() => "")
        return head + content.trim()
      }),
    )
    const last = matches.at(-1)
    return chunks.join("") + (last ? body.slice((last.index ?? 0) + last[0].length) : "")
  }
}
