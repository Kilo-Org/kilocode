import type { AssistantMessage, Part } from "@kilocode/sdk/v2"

export const previewDuration = 3500

type Sample = {
  thought: AssistantMessage
  thoughts: Part[]
  message: AssistantMessage
  parts: Part[]
  copy?: string
}

// Each tool is pending while the model writes its arguments, then runs, then
// completes: [start, running, end].
const windows: Record<string, [number, number, number]> = {
  sample_docs_lookup: [1200, 1260, 1400],
  edit: [1400, 1480, 1600],
  bash: [1600, 1760, 2000],
}

// Frames are reconciled by part ID, so streaming never replaces mounted parts.
// Each replay cycle suffixes every part ID so the next loop mounts fresh rows.
export function previewFrame(sample: Sample, elapsed: number, reduced = false, cycle = 0): Sample {
  const frame = structuredClone(sample)
  const stamp = sample.message.time.created
  const text = (value: string, start: number, end: number) =>
    value.slice(0, Math.ceil(value.length * Math.min(1, Math.max(0, (elapsed - start) / (end - start)))))
  // Mirror what the extension streams while arguments arrive: a command types
  // in, other fields appear once complete, and edit strings stay hidden.
  const streamed = (input: Record<string, unknown>, start: number, run: number) => {
    const next: Record<string, unknown> = {}
    if (typeof input.command === "string") next.command = reduced ? input.command : text(input.command, start, run - 40)
    if (typeof input.description === "string" && elapsed >= run - 30) next.description = input.description
    if (typeof input.filePath === "string" && elapsed >= (start + run) / 2) next.filePath = input.filePath
    return next
  }
  frame.thought.time = { created: stamp, completed: elapsed >= 1200 ? stamp + 1200 : undefined }
  frame.message.time = { created: stamp, completed: elapsed >= 2500 ? stamp + 2500 : undefined }
  frame.thoughts = frame.thoughts.map((part) => {
    if (part.type !== "reasoning") return part
    part.text = reduced ? part.text : text(part.text, 0, 1200)
    part.time = { start: stamp, end: elapsed >= 1200 ? stamp + 1200 : undefined }
    return part
  })
  frame.parts = frame.parts.flatMap((part): Part[] => {
    if (part.type === "tool" && part.state.status === "completed") {
      const [start, run, end] = windows[part.tool] ?? windows.bash!
      if (elapsed < start) return []
      const state = part.state
      if (elapsed < run) {
        part.state = { status: "pending", input: streamed(state.input, start, run), raw: "" }
        return [part]
      }
      part.state =
        elapsed >= end
          ? { ...state, time: { start: stamp + run, end: stamp + end } }
          : {
              status: "running",
              input: state.input,
              title: state.title,
              metadata: {
                approval: state.metadata.approval,
                output: state.output,
              },
              time: { start: stamp + run },
            }
      return [part]
    }
    if (part.type === "text") {
      if (elapsed < 2000) return []
      part.text = reduced ? part.text : text(part.text, 2000, 2500)
      part.time = { start: stamp + 2000, end: elapsed >= 2500 ? stamp + 2500 : undefined }
      return [part]
    }
    return elapsed >= 2500 ? [part] : []
  })
  frame.parts = frame.parts.map((part) => {
    if (part.type === "tool") return { ...part, id: `${part.id}-${cycle}`, callID: `${part.callID}-${cycle}` }
    return { ...part, id: `${part.id}-${cycle}` }
  })
  if (frame.copy !== undefined) frame.copy = `${frame.copy}-${cycle}`
  return frame
}
