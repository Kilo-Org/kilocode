import { readdir, unlink } from "fs/promises"
import path from "path"
import { MemoryFs } from "./fs"
import { MemoryPaths } from "./paths"
import { MemoryRedact } from "../capture/redact"
import { MemorySlug } from "../slug"
import { MemoryText } from "../text"

export namespace MemorySessions {
  type Digest = {
    file: string
    id: string
    time: string
    topic: string
    summary: string
    fallback: boolean
  }

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

  function topic(input: { summary: string; topic?: string }) {
    return MemoryText.brief(input.topic || input.summary.split(/[.;]/)[0] || input.summary, 80)
  }

  async function list(root: string) {
    const paths = MemoryPaths.files(root)
    const names = await readdir(paths.sessions).catch((error: unknown) => {
      if (MemoryFs.miss(error)) return [] as string[]
      throw error
    })
    return { paths, names }
  }

  async function drop(file: string) {
    await unlink(file).catch((error: unknown) => {
      if (MemoryFs.miss(error)) return
      throw error
    })
  }

  function content(input: { id: string; topic: string; summary: string; time: number; fallback?: boolean }) {
    return [
      `# Session ${input.id}`,
      "",
      "Version: 1",
      `Updated: ${new Date(input.time).toISOString()}`,
      ...(input.fallback ? ["Fallback: true"] : []),
      `Topic: ${input.topic}`,
      "",
      "## Summary",
      input.summary,
      "",
    ].join("\n")
  }

  function draft(
    root: string,
    input: { sessionID: string; topic?: string; summary: string; max: number; time?: number; fallback?: boolean },
  ) {
    const paths = MemoryPaths.files(root)
    const id = MemorySlug.safe(input.sessionID, { max: MemorySlug.max.label, fallback: "session" })
    const time = input.time ?? Date.now()
    if (!Number.isFinite(time)) throw new RangeError("memory session time must be finite")
    const hash = MemorySlug.hash(input.sessionID, "id")
    const name = `${stamp(time)}_${id}_${hash}.md`
    const summary = MemoryText.brief(MemoryRedact.text(input.summary), input.max)
    const label = topic({ summary, topic: input.topic ? MemoryRedact.text(input.topic) : undefined })
    return {
      id: input.sessionID,
      name,
      file: path.join(paths.sessions, name),
      text: content({ id: input.sessionID, topic: label, summary, time, fallback: input.fallback }),
    }
  }

  function parse(file: string, content: string, max: number): Digest | undefined {
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
    const fallback = lines.slice(0, idx).some((line) => line.trim().toLowerCase() === "fallback: true")
    const summary = MemoryText.brief(lines.slice(idx + 1).find((line) => line.trim()) ?? "", max)
    if (!summary) return
    return { file, id: session(file, content), time, topic: topic({ summary, topic: label }), summary, fallback }
  }

  async function removePrior(root: string, id: string, keep: string) {
    const listed = await list(root)
    await Promise.all(
      listed.names.map(async (file) => {
        if (!file.endsWith(".md") || file === keep) return
        const content = await MemoryFs.read(path.join(listed.paths.sessions, file))
        if (!content || session(file, content) !== id) return
        await drop(path.join(listed.paths.sessions, file))
      }),
    )
  }

  export async function writeSession(
    root: string,
    input: { sessionID: string; topic?: string; summary: string; max: number; time?: number; fallback?: boolean },
  ) {
    const paths = MemoryPaths.files(root)
    await MemoryFs.dir(paths.sessions)
    const next = draft(root, input)
    await MemoryFs.write(next.file, next.text)
    await removePrior(root, next.id, next.name)
    return next.file
  }

  export async function readSession(root: string, input: { sessionID: string; max: number }) {
    const listed = await list(root)
    return listed.names
      .filter((item) => item.endsWith(".md"))
      .sort()
      .reverse()
      .reduce(
        async (prior, file) => {
          const current = await prior
          if (current) return current
          const content = await MemoryFs.read(path.join(listed.paths.sessions, file))
          if (!content) return
          const item = parse(file, content, input.max)
          if (item?.id !== input.sessionID) return
          return item
        },
        Promise.resolve(undefined as Digest | undefined),
      )
  }

  export async function pruneSessions(root: string, max: number) {
    const listed = await list(root)
    const keep = Math.max(0, max)
    await Promise.all(
      listed.names
        .filter((file) => file.endsWith(".md"))
        .sort()
        .reverse()
        .slice(keep)
        .map((file) => drop(path.join(listed.paths.sessions, file))),
    )
  }

  export async function recentSessions(root: string, limit: number, max: number) {
    const listed = await list(root)
    const result: Digest[] = []
    for (const file of listed.names
      .filter((item) => item.endsWith(".md"))
      .sort()
      .reverse()
      .slice(0, limit)) {
      const content = await MemoryFs.read(path.join(listed.paths.sessions, file))
      if (!content) continue
      const item = parse(file, content, max)
      if (item) result.push(item)
    }
    return result
  }
}
