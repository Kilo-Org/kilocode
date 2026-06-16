import { readdir, unlink } from "fs/promises"
import path from "path"
import { MemoryFs } from "./fs"
import { MemoryPaths } from "./paths"
import { MemoryRedact } from "../capture/redact"
import { MemorySlug } from "../slug"

export namespace MemorySessions {
  function stamp(input: number) {
    return new Date(input).toISOString().replaceAll(":", "-")
  }

  function session(file: string, content: string) {
    const header = content
      .split("\n")
      .find((line) => line.startsWith("# Session "))
      ?.slice("# Session ".length)
      .trim()
    if (header) return header
    const idx = file.indexOf("_")
    return idx === -1 ? file.replace(/\.md$/, "") : file.slice(idx + 1).replace(/\.md$/, "")
  }

  function trim(input: string, max: number) {
    const text = input.trim().replaceAll(/\s+/g, " ")
    if (text.length <= max) return text
    return `${text.slice(0, Math.max(0, max - 3))}...`
  }

  function topic(input: { summary: string; topic?: string }) {
    return trim(input.topic || input.summary.split(/[.;:]/)[0] || input.summary, 80)
  }

  async function removePrior(root: string, id: string, keep: string) {
    const paths = MemoryPaths.files(root)
    const files = await readdir(paths.sessions).catch((error: unknown) => {
      if (MemoryFs.miss(error)) return [] as string[]
      throw error
    })
    await Promise.all(
      files.flatMap(async (file) => {
        if (!file.endsWith(".md") || file === keep) return
        const content = await MemoryFs.read(path.join(paths.sessions, file))
        if (!content || session(file, content) !== id) return
        await unlink(path.join(paths.sessions, file)).catch((error: unknown) => {
          if (MemoryFs.miss(error)) return
          throw error
        })
      }),
    )
  }

  export async function writeSession(
    root: string,
    input: { sessionID: string; topic?: string; summary: string; max: number; time?: number },
  ) {
    const paths = MemoryPaths.files(root)
    await MemoryFs.dir(paths.sessions)
    const id = MemorySlug.safe(input.sessionID, { max: MemorySlug.max.label, fallback: "session" })
    const time = input.time ?? Date.now()
    if (!Number.isFinite(time)) throw new RangeError("memory session time must be finite")
    const hash = MemorySlug.hash(input.sessionID, "id")
    const name = `${stamp(time)}_${id}_${hash}.md`
    const file = path.join(paths.sessions, name)
    const summary = trim(MemoryRedact.text(input.summary), input.max)
    const label = topic({ summary, topic: input.topic ? MemoryRedact.text(input.topic) : undefined })
    await MemoryFs.write(
      file,
      [
        `# Session ${input.sessionID}`,
        "",
        "Version: 1",
        `Updated: ${new Date(time).toISOString()}`,
        `Topic: ${label}`,
        "",
        "## Summary",
        summary,
        "",
      ].join("\n"),
    )
    await removePrior(root, input.sessionID, name)
    return file
  }

  export async function readSession(root: string, input: { sessionID: string; max: number }) {
    const paths = MemoryPaths.files(root)
    const files = await readdir(paths.sessions).catch((error: unknown) => {
      if (MemoryFs.miss(error)) return [] as string[]
      throw error
    })
    const found = await files
      .filter((item) => item.endsWith(".md"))
      .sort()
      .reverse()
      .reduce(async (prior, file) => {
        const current = await prior
        if (current) return current
        const content = await MemoryFs.read(path.join(paths.sessions, file))
        if (!content || session(file, content) !== input.sessionID) return
        return { file, content }
      }, Promise.resolve(undefined as { file: string; content: string } | undefined))
    if (!found) return
    const file = found.file
    const content = found.content
    const lines = content.split("\n")
    const idx = lines.findIndex((line) => line.trim() === "## Summary")
    if (idx < 0) return
    const time =
      lines
        .find((line) => line.startsWith("Updated: "))
        ?.slice("Updated: ".length)
        .trim() ?? file
    const label = lines
      .find((line) => line.startsWith("Topic: "))
      ?.slice("Topic: ".length)
      .trim()
    const summary = trim(lines.slice(idx + 1).find((line) => line.trim()) ?? "", input.max)
    if (!summary) return
    return { file, id: session(file, content), time, topic: topic({ summary, topic: label }), summary }
  }

  export async function pruneSessions(root: string, max: number) {
    const paths = MemoryPaths.files(root)
    const files = await readdir(paths.sessions).catch((error: unknown) => {
      if (MemoryFs.miss(error)) return [] as string[]
      throw error
    })
    const keep = Math.max(0, max)
    await Promise.all(
      files
        .filter((file) => file.endsWith(".md"))
        .sort()
        .reverse()
        .slice(keep)
        .map((file) =>
          unlink(path.join(paths.sessions, file)).catch((error: unknown) => {
            if (MemoryFs.miss(error)) return
            throw error
          }),
        ),
    )
  }

  export async function recentSessions(root: string, limit: number, max: number) {
    const paths = MemoryPaths.files(root)
    const files = await readdir(paths.sessions).catch((error: unknown) => {
      if (MemoryFs.miss(error)) return [] as string[]
      throw error
    })
    const result: { file: string; id: string; time: string; topic: string; summary: string }[] = []
    for (const file of files
      .filter((item) => item.endsWith(".md"))
      .sort()
      .reverse()
      .slice(0, limit)) {
      const content = await MemoryFs.read(path.join(paths.sessions, file))
      if (!content) continue
      const lines = content.split("\n")
      const idx = lines.findIndex((line) => line.trim() === "## Summary")
      if (idx < 0) continue
      const time =
        lines
          .find((line) => line.startsWith("Updated: "))
          ?.slice("Updated: ".length)
          .trim() ?? file
      const label = lines
        .find((line) => line.startsWith("Topic: "))
        ?.slice("Topic: ".length)
        .trim()
      const summary = trim(lines.slice(idx + 1).find((line) => line.trim()) ?? "", max)
      if (summary)
        result.push({ file, id: session(file, content), time, topic: topic({ summary, topic: label }), summary })
    }
    return result
  }
}
