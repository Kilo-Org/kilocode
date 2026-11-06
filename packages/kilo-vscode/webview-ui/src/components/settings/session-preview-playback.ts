import type { SessionMessageAssistant } from "@opencode/client"

export const previewDuration = 3500

type Sample = { message: SessionMessageAssistant }

// Each tool is pending while the model writes its arguments, then runs, then
// completes: [start, running, end].
const windows: Record<string, [number, number, number]> = {
  sample_docs_lookup: [1200, 1260, 1400],
  edit: [1400, 1480, 1600],
  shell: [1600, 1760, 2000],
}

// Frames are reconciled by part identity, so streaming never replaces mounted
// parts. Each replay cycle suffixes every tool ID so the next loop mounts fresh rows.
export function previewFrame(sample: Sample, elapsed: number, reduced = false, cycle = 0): Sample {
  const frame = structuredClone(sample)
  const stamp = sample.message.time.created
  const text = (value: string, start: number, end: number) =>
    value.slice(0, Math.ceil(value.length * Math.min(1, Math.max(0, (elapsed - start) / (end - start)))))
  frame.message.time = {
    ...frame.message.time,
    completed: elapsed >= 2500 ? stamp + 2500 : undefined,
    streamed: elapsed >= 2500 ? stamp + 2500 : undefined,
  }
  frame.message.id = `${frame.message.id}-${cycle}`
  const content: SessionMessageAssistant["content"] = []
  for (const part of frame.message.content) {
    if (part.type === "reasoning") {
      part.text = reduced ? part.text : text(part.text, 0, 1200)
      part.time = { created: stamp, completed: elapsed >= 1200 ? stamp + 1200 : undefined }
      content.push(part)
      continue
    }
    if (part.type === "tool" && part.state.status === "completed") {
      const [start, run, end] = windows[part.name] ?? windows.shell!
      if (elapsed < start) continue
      const completed = part.state
      if (elapsed < run) {
        part.state = { status: "streaming", input: "" }
        part.time = { created: stamp + start }
      } else if (elapsed < end) {
        part.state = { status: "running", input: completed.input, metadata: completed.metadata ?? {} }
        part.time = { created: stamp + start, ran: stamp + run }
      } else {
        part.time = { created: stamp + start, ran: stamp + run, completed: stamp + end }
      }
      content.push(part)
      continue
    }
    if (part.type === "text") {
      if (elapsed < 2000) continue
      part.text = reduced ? part.text : text(part.text, 2000, 2500)
      content.push(part)
      continue
    }
    content.push(part)
  }
  frame.message.content = content.map((part) => (part.type === "tool" ? { ...part, id: `${part.id}-${cycle}` } : part))
  return frame
}
