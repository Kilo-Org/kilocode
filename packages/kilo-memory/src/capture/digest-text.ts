import { MemoryDigest } from "./digest"
import { MemoryRedact } from "./redact"
import { MemoryShared } from "../recall/shared"
import type { CaptureDigest } from "./parse"

export function cap(input: string, max: number) {
  if (Buffer.byteLength(input) <= max) return input
  const chars: string[] = []
  let bytes = 0
  for (const char of input) {
    const size = Buffer.byteLength(char)
    if (bytes + size > max) break
    chars.push(char)
    bytes += size
  }
  return chars.join("")
}

function body(input: string | undefined, fallback = "(empty)") {
  const text = MemoryRedact.text(input?.trim().replaceAll("```", "'''") ?? "")
  return text || fallback
}

export function evidence(sections: { title: string; body?: string }[]) {
  return [
    "```kilo-memory-evidence-v1",
    ...sections.flatMap((section) => [`## ${section.title}`, body(section.body)]),
    "```",
  ].join("\n")
}

export function summarize(input: { user: string; assistant: string; max: number }) {
  const user = MemoryShared.brief(MemoryRedact.text(input.user), Math.max(24, Math.floor(input.max * 0.45)))
  const assistant = MemoryShared.brief(MemoryRedact.text(input.assistant), Math.max(24, Math.floor(input.max * 0.45)))
  const text = [user ? `User: ${user}` : "", assistant ? `Result: ${assistant}` : ""].filter(Boolean).join(" ")
  return MemoryShared.brief(text, input.max)
}

export function fallbackDigest(input: { prior?: string; summary: string; max: number }) {
  if (!input.prior?.trim()) return MemoryShared.brief(input.summary, input.max)
  const prior = MemoryShared.brief(input.prior ?? "", Math.max(0, Math.floor(input.max * 0.55)))
  const latest = MemoryShared.brief(input.summary, Math.max(0, input.max - prior.length - 9))
  return MemoryShared.brief([prior, latest ? `Latest: ${latest}` : ""].filter(Boolean).join(" "), input.max)
}

export function parseDigest(input: CaptureDigest, fallback: string, max: number) {
  const summary = MemoryShared.brief(input.summary.trim() || fallback, max)
  const topic = MemoryShared.brief(input.topic.trim() || summary.split(/[.;:]/)[0] || summary, 80)
  if (MemoryDigest.empty({ topic, summary })) return { topic: "", summary: "" }
  return { topic, summary }
}
