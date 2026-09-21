import type { AssistantMessage, Part } from "@kilocode/sdk/v2"

export const previewDuration = 3500

type Sample = {
  thought: AssistantMessage
  thoughts: Part[]
  message: AssistantMessage
  parts: Part[]
}

// Frames are reconciled by part ID, so streaming never replaces mounted parts.
export function previewFrame(sample: Sample, elapsed: number, reduced = false): Sample {
  const frame = structuredClone(sample)
  const stamp = sample.message.time.created
  const text = (value: string, start: number, end: number) =>
    value.slice(0, Math.ceil(value.length * Math.min(1, Math.max(0, (elapsed - start) / (end - start)))))
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
      const [start, end] =
        part.tool === "sample_docs_lookup" ? [1200, 1400] : part.tool === "edit" ? [1400, 1600] : [1600, 2000]
      if (elapsed < start) return []
      const state = part.state
      part.state =
        elapsed >= end
          ? { ...state, time: { start: stamp + start, end: stamp + end } }
          : {
              status: "running",
              input: state.input,
              title: state.title,
              metadata: {
                approval: state.metadata.approval,
                output: state.output,
              },
              time: { start: stamp + start },
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
  return frame
}
